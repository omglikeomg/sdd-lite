#!/usr/bin/env node
// `pnpm doctor` — is this clone ready to work? Read-only; every problem names its fix.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { HUB_ROOT, DIRS, loadConfig } from './lib/hub.mjs';
import { git, gitTry } from './lib/git.mjs';
import { MARKER, HUB_HOOKS, hookSelfTest } from './lib/hooks.mjs';
import { parsePlanFilename } from './lib/conventions.mjs';
import { parsePlan } from './lib/plans.mjs';
import { prerequisiteProblems, HUB_GIT_CONFIG } from './setup.mjs';
import { requireGh } from './lib/github.mjs';
import { TESTED, findSuperpowers, superpowersProblems, compareVersions } from './lib/compat.mjs';

const results = [];
const ok = (msg) => results.push({ ok: true, msg });
const bad = (msg, fix) => results.push({ ok: false, msg, fix });
// Worth knowing, not a failure.
const note = (msg) => results.push({ ok: true, note: true, msg });

const pre = prerequisiteProblems();
if (pre.length) for (const p of pre) bad(p, 'install or upgrade, then rerun `pnpm doctor`');
else ok('Node, git and Graphify versions');

// The hub's rules depend on how Graphify and Superpowers behave; tools/lib/compat.mjs lists what.
const graphifyVersion = /(\d+\.\d+\.\d+)/.exec(spawnSync('graphify', ['--version'], { encoding: 'utf8' }).stdout || '')?.[1];
if (graphifyVersion && compareVersions(graphifyVersion, TESTED.graphify) !== 0) {
  note(`Graphify ${graphifyVersion}; the hub was verified with ${TESTED.graphify}. Run \`pnpm test\` (tools/test/compat.test.mjs) to check the behaviours it relies on`);
}
const sp = findSuperpowers();
if (!sp) note('Superpowers not found in Claude Code\'s or OpenCode\'s plugin folders; install it (docs/ONBOARDING.md), or set SUPERPOWERS_DIR if it lives elsewhere');
else {
  const problems = superpowersProblems(sp.dir);
  for (const p of problems) bad(`Superpowers ${sp.version}: ${p}`, 'read the changed skill and adjust the hub rule that depends on it (docs/WORKFLOW.md, "Tested with")');
  if (!problems.length) ok(`Superpowers ${sp.version}${sp.version === TESTED.superpowers ? '' : ` (verified with ${TESTED.superpowers}; the texts the hub relies on are present)`}`);
}

const hooksDir = git(HUB_ROOT, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
const missingHub = HUB_HOOKS.filter((h) => !existsSync(join(hooksDir, h)) || !readFileSync(join(hooksDir, h), 'utf8').includes(MARKER));
if (missingHub.length) bad(`hub hooks missing: ${missingHub.join(', ')}`, 'pnpm hub:setup');
else ok('hub hooks installed');

const wrongConfig = HUB_GIT_CONFIG.filter(([k, v]) => gitTry(HUB_ROOT, ['config', '--get', k]).out !== v);
if (wrongConfig.length) bad(`hub git config not set: ${wrongConfig.map(([k, v]) => `${k}=${v}`).join(', ')}`, 'pnpm hub:setup');
else ok('hub git config (submodule.recurse, push.recurseSubmodules)');

const cfg = loadConfig(HUB_ROOT);
if (cfg.github.enabled) {
  try {
    requireGh();
    const who = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).stdout.trim();
    const owner = cfg.github.hubRepo.split('/')[0];
    ok(`GitHub mode: gh acts as ${who || 'an unknown account'}; tracking issues in ${cfg.github.hubRepo}`);
    if (who && who !== owner) console.log(`    note: the hub repository belongs to ${owner}; if that is another of your accounts, \`gh auth switch --user ${owner}\``);
  } catch (e) {
    bad(e.message, 'gh auth login (see docs/GITHUB.md)');
  }
  for (const r of cfg.repos.filter((r) => !r.github)) bad(`${r.path} has no "github" slug`, 'pnpm gh:setup, or set it in hub.config.json');
}
const status = existsSync(join(HUB_ROOT, '.gitmodules')) ? git(HUB_ROOT, ['submodule', 'status']) : '';
for (const repo of cfg.repos) {
  const dir = join(HUB_ROOT, repo.path);
  if (!existsSync(join(dir, '.git'))) {
    bad(`${repo.path} is not checked out`, 'pnpm hub:setup');
    continue;
  }
  const line = status.split('\n').find((l) => l.trim().split(/\s+/)[1] === repo.path) || '';
  if (line.startsWith('+')) bad(`${repo.path} is not at the hub's pointer (documents describe different code)`, 'git submodule update --init');
  else ok(`${repo.path} at the hub's pointer`);
  const problems = hookSelfTest(dir, null);
  if (problems.length) bad(`${repo.path} hooks: ${problems.join('; ')}`, 'pnpm hub:setup (for lefthook repositories run pnpm install there first)');
  else ok(`${repo.path} hooks run`);
}

const plansDir = join(HUB_ROOT, DIRS.plans);
for (const name of existsSync(plansDir) ? readdirSync(plansDir) : []) {
  const p = parsePlanFilename(name);
  if (!p) continue;
  const wt = `.worktrees/${p.repo}--${p.id}-${p.slug}`;
  if (existsSync(join(HUB_ROOT, wt)) && parsePlan(readFileSync(join(plansDir, name), 'utf8')).completion) {
    bad(`${wt} belongs to completed plan ${p.id}`, `pnpm plan:cleanup ${p.id} (after the completion PR is merged)`);
  }
}

for (const r of results) console.log(`${r.note ? '!' : r.ok ? '✔' : '✖'} ${r.msg}${r.ok ? '' : `\n    fix: ${r.fix}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n[doctor] ${failed} problem(s)` : '\n[doctor] ok');
process.exit(failed ? 1 : 0);
