import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync, appendFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { RUN_HOOK, HubError } from './hub.mjs';
import { git, cleanGitEnv } from './git.mjs';

export const MARKER = 'managed-by: hub-workflow';
export const REPO_HOOKS = ['prepare-commit-msg', 'commit-msg', 'pre-push'];
export const HUB_HOOKS = ['pre-commit', 'commit-msg'];
const LEFTHOOK_CONFIGS = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'];
const LEFTHOOK_UNSUPPORTED = ['lefthook.json', 'lefthook.toml', '.lefthook.json', '.lefthook.toml'];

export function lefthookConfig(dir) {
  const unsupported = LEFTHOOK_UNSUPPORTED.find((f) => existsSync(join(dir, f)));
  if (unsupported) throw new HubError(`${dir}: ${unsupported} is not supported; hub hooks need a YAML lefthook config`);
  const main = LEFTHOOK_CONFIGS.find((f) => existsSync(join(dir, f)));
  if (!main) return null;
  return { main, local: main.startsWith('.') ? '.lefthook-local.yml' : 'lefthook-local.yml' };
}

function hooksDir(cwd) {
  return git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
}

export function addExcludes(cwd, patterns) {
  const file = git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']);
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const missing = patterns.filter((p) => !current.split('\n').includes(p));
  if (missing.length) appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + `# ${MARKER}\n` + missing.join('\n') + '\n');
}

function hookScript(hook, args) {
  const run = `node "${RUN_HOOK}" ${hook} ${args} "$@"`;
  const chain = `"$HOOK_DIR/${hook}.local"`;
  if (hook === 'pre-push') {
    return `#!/bin/sh
# ${MARKER} — written by \`pnpm hub:setup\`; change tools/git-hooks/run.mjs instead of this file.
HOOK_DIR=$(dirname "$0")
input=$(cat)
if [ -x ${chain} ]; then printf '%s\\n' "$input" | ${chain} "$@" || exit $?; fi
printf '%s\\n' "$input" | ${run}
`;
  }
  return `#!/bin/sh
# ${MARKER} — written by \`pnpm hub:setup\`; change tools/git-hooks/run.mjs instead of this file.
HOOK_DIR=$(dirname "$0")
if [ -x ${chain} ]; then ${chain} "$@" || exit $?; fi
exec ${run}
`;
}

// Plain hook files in the repository's hooks directory (shared by all its worktrees). A hook the
// team already had is kept as <hook>.local and runs first.
export function installPlainHooks(cwd, hooks, args) {
  const dir = hooksDir(cwd);
  mkdirSync(dir, { recursive: true });
  for (const hook of hooks) {
    const file = join(dir, hook);
    if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARKER)) {
      if (existsSync(`${file}.local`)) throw new HubError(`${file} exists and ${file}.local is taken; merge them by hand`);
      renameSync(file, `${file}.local`);
    }
    writeFileSync(file, hookScript(hook, args));
    chmodSync(file, 0o755);
  }
  return dir;
}

export function lefthookLocalYaml(repoName) {
  const run = (hook, args) => `node "${RUN_HOOK}" ${hook} --repo ${repoName} ${args}`.trim();
  return `# ${MARKER} — local only (listed in .git/info/exclude); rewritten by \`pnpm hub:setup\`.
prepare-commit-msg:
  commands:
    hub-plan-footer:
      run: ${run('prepare-commit-msg', '{1} {2}')}
commit-msg:
  commands:
    hub-commit-msg:
      run: ${run('commit-msg', '{1}')}
pre-push:
  commands:
    hub-pre-push:
      use_stdin: true
      run: ${run('pre-push', '{1} {2}')}
`;
}

// The repository's own lefthook, else one on PATH. Never `pnpm exec`: it runs from the nearest
// package.json, which for a repository without one is the hub's, and would install hooks there.
function lefthookBinary(dir) {
  for (const bin of [join(dir, 'node_modules', '.bin', 'lefthook'), 'lefthook']) {
    if (spawnSync(bin, ['version'], { cwd: dir, encoding: 'utf8' }).status === 0) return bin;
  }
  return null;
}

export function installLefthook(dir, repoName, lh) {
  const localFile = join(dir, lh.local);
  if (existsSync(localFile) && !readFileSync(localFile, 'utf8').includes(MARKER)) {
    throw new HubError(`${localFile} already exists and is not managed by the hub; move its commands into ${lh.main} first`);
  }
  writeFileSync(localFile, lefthookLocalYaml(repoName));
  addExcludes(dir, [lh.local]);
  const bin = lefthookBinary(dir);
  if (!bin) throw new HubError(`${dir} uses lefthook but no lefthook binary was found; run \`pnpm install\` there, then \`pnpm hub:setup\``);
  execFileSync(bin, ['install'], { cwd: dir, env: cleanGitEnv(), stdio: 'pipe' });
}

export function installRepoHooks(dir, repoName) {
  addExcludes(dir, ['.superpowers/', 'graphify-out/']);
  const lh = lefthookConfig(dir);
  if (lh) {
    installLefthook(dir, repoName, lh);
    return `lefthook (${lh.local})`;
  }
  installPlainHooks(dir, REPO_HOOKS, `--repo ${repoName}`);
  return 'plain git hooks';
}

export function copyLefthookLocal(repoDir, worktreeDir) {
  const lh = lefthookConfig(repoDir);
  if (lh && existsSync(join(repoDir, lh.local))) copyFileSync(join(repoDir, lh.local), join(worktreeDir, lh.local));
}

// Prove git really runs the hub's commit-msg hook in `dir`: a bad message must be rejected and a
// valid one for this plan accepted. A missing hook fails the second half.
export function hookSelfTest(dir, id) {
  const tmp = mkdtempSync(join(tmpdir(), 'hub-hook-test-'));
  const bad = join(tmp, 'bad');
  const good = join(tmp, 'good');
  writeFileSync(bad, 'not a conventional commit\n');
  writeFileSync(good, id ? `chore: hub hook self-test\n\nPlan: ${id}\nTask: 1\n` : 'chore: hub hook self-test\n');
  const run = (file) => spawnSync('git', ['hook', 'run', 'commit-msg', '--', file], { cwd: dir, env: cleanGitEnv(), encoding: 'utf8' });
  const rb = run(bad);
  const rg = run(good);
  const problems = [];
  if (rb.status === 0) problems.push('commit-msg hook accepted a non-conventional message (hook missing or not running the hub check)');
  if (rg.status !== 0) problems.push(`commit-msg hook rejected a valid plan commit: ${(rg.stderr || rg.stdout).trim() || `exit ${rg.status}`}`);
  return problems;
}
