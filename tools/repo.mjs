#!/usr/bin/env node
// `pnpm repo:add <name> <git-url> [--preset nest,next,sst,cqrs] [--branch main]`
// `pnpm repo:sync <name>`
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HUB_ROOT, loadConfig, saveConfig, repoConfig, HubError, skipGraphify } from './lib/hub.mjs';
import { git, gitTry, freshBase, isAncestor } from './lib/git.mjs';
import { REPO_NAME_RE } from './lib/conventions.mjs';
import { setupRepo } from './setup.mjs';
import { slugFromUrl, requireGh, ensureLabels, repoLabel } from './lib/github.mjs';

export const DEFAULT_TESTS = ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx', '**/*.e2e-spec.ts'];
export const PRESETS = {
  nest: ['**/*.module.ts'],
  next: ['**/app/*/layout.tsx', '**/app/*/page.tsx'],
  sst: ['**/sst.config.ts', '**/infra/**/*.ts'],
  cqrs: ['**/*.handler.ts'],
};

function add(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { preset: { type: 'string', default: '' }, branch: { type: 'string', default: 'main' }, github: { type: 'string' } },
  });
  const [name, url] = positionals;
  if (!name || !url) throw new HubError('usage: pnpm repo:add <name> <git-url> [--preset nest,next,sst] [--branch main]');
  if (!REPO_NAME_RE.test(name)) throw new HubError(`repo name "${name}" must be lowercase letters, digits and hyphens`);
  const presets = values.preset.split(',').filter(Boolean);
  for (const p of presets) if (!PRESETS[p]) throw new HubError(`unknown preset "${p}" (available: ${Object.keys(PRESETS).join(', ')})`);
  const cfg = loadConfig(HUB_ROOT);
  if (cfg.repos.some((r) => r.name === name)) throw new HubError(`repo "${name}" is already configured`);
  const path = `repos/${name}`;
  if (existsSync(join(HUB_ROOT, path))) throw new HubError(`${path} already exists`);

  git(HUB_ROOT, ['submodule', 'add', '-b', values.branch, url, path]);
  const repo = { name, path, github: values.github || slugFromUrl(url), defaultBranch: values.branch, tests: DEFAULT_TESTS, mustDocument: presets.flatMap((p) => PRESETS[p]) };
  if (cfg.github.enabled) {
    if (!repo.github) throw new HubError(`cannot tell the GitHub repository from ${url}; pass --github owner/name`);
    requireGh();
    ensureLabels(cfg.github.hubRepo, [repoLabel(name)]);
  }
  cfg.repos.push(repo);
  saveConfig(HUB_ROOT, cfg);
  console.log(`[repo] added ${path} (${values.branch}); hooks: ${setupRepo(HUB_ROOT, repo)}`);
  if (!skipGraphify()) {
    const r = spawnSync('graphify', ['update', '.'], { cwd: HUB_ROOT, encoding: 'utf8' });
    if (r.status === 0) console.log(`[repo] knowledge graph built with ${path} in it (graphify update .)`);
    else console.warn(`[repo] warning: \`graphify update .\` failed; run it before writing the architecture map:\n${(r.stderr || r.stdout).trim()}`);
  }
  console.log(`[repo] next: ask your agent to "onboard ${name}". Its onboard-repository skill drafts
  docs/codebases/${name}/ARCHITECTURE.md from the graph, links it from docs/ARCHITECTURE.md, runs
  \`pnpm check\`, and proposes the hub PR on chore/onboard-${name} for a person to review.`);
}

function graphifyUpdate() {
  if (skipGraphify()) return;
  const r = spawnSync('graphify', ['update', '.'], { cwd: HUB_ROOT, encoding: 'utf8' });
  if (r.status === 0) console.log('[repo] graph refreshed (graphify update .)');
  else console.warn(`[repo] warning: \`graphify update .\` failed; the graph is stale until it succeeds:\n${(r.stderr || r.stdout).trim()}`);
}

// Move a repository's submodule pointer to its freshly fetched default branch and stage it, for the
// hub PR that documents merged bounded work (or resolves a pointer conflict between two PRs).
function sync(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [name] = positionals;
  if (!name) throw new HubError('usage: pnpm repo:sync <name>');
  const repo = repoConfig(loadConfig(HUB_ROOT), name);
  const dir = join(HUB_ROOT, repo.path);
  if (!existsSync(join(dir, '.git'))) throw new HubError(`${repo.path} is not checked out; run \`pnpm hub:setup\``);
  if (git(dir, ['status', '--porcelain']) !== '') {
    throw new HubError(`${repo.path} has local changes; product work belongs in a worktree (docs/TROUBLESHOOTING.md, "Submodules")`);
  }
  const target = freshBase(dir, repo.defaultBranch);
  const before = git(dir, ['rev-parse', 'HEAD']);
  const after = git(dir, ['rev-parse', `${target}^{commit}`]);
  // Leaving a commit no branch contains would orphan it; ask for it to be saved first.
  if (!isAncestor(dir, before, after) && !gitTry(dir, ['for-each-ref', '--contains', before, 'refs/heads', 'refs/remotes']).out) {
    throw new HubError(`${repo.path} is at ${before.slice(0, 12)}, which no branch contains. Save it first: \`git -C ${repo.path} branch rescue/<slug> HEAD\`, then rerun`);
  }
  if (before !== after) git(dir, ['checkout', '--quiet', '--detach', after]);
  git(HUB_ROOT, ['add', repo.path]);
  const count = isAncestor(dir, before, after) ? git(dir, ['rev-list', '--count', `${before}..${after}`]) : null;
  console.log(before === after
    ? `[repo] ${repo.path} is already at ${target} (${after.slice(0, 12)}); pointer staged`
    : `[repo] ${repo.path}: ${before.slice(0, 12)} -> ${after.slice(0, 12)} (${count === null ? 'not a descendant of the old pointer' : `${count} commit(s)`} from ${target}); pointer staged`);
  if (before !== after) graphifyUpdate();
  console.log(`  Next: update the documents that describe the new code, \`pnpm check\`, and commit them with the pointer in one hub PR.`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'add') add(rest);
  else if (cmd === 'sync') sync(rest);
  else throw new HubError('usage: pnpm repo:add <name> <git-url> [--preset nest,next,sst] [--branch main]  |  pnpm repo:sync <name>');
} catch (e) {
  console.error(`[repo] ${e.message}`);
  process.exit(1);
}
