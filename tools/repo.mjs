#!/usr/bin/env node
// `pnpm repo:add <name> <git-url> [--preset nest,next,sst,cqrs,cqrs] [--branch main]`
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HUB_ROOT, loadConfig, saveConfig, HubError } from './lib/hub.mjs';
import { git } from './lib/git.mjs';
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
  console.log(`[repo] next:
  1. Copy docs/templates/REPO-ARCHITECTURE.md to docs/codebases/${name}/ARCHITECTURE.md and describe ${path}.
  2. Link it from the "Product repositories" table in docs/ARCHITECTURE.md.
  3. Run \`pnpm check\` until it is green, then commit: chore(repos): add ${name}`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'add') add(rest);
  else throw new HubError('usage: pnpm repo:add <name> <git-url> [--preset nest,next,sst] [--branch main]');
} catch (e) {
  console.error(`[repo] ${e.message}`);
  process.exit(1);
}
