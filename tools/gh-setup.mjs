#!/usr/bin/env node
// `pnpm gh:setup [--hub-repo owner/name]` — turn on GitHub mode: check `gh`, record the repository
// slugs, create the labels. Safe to rerun; labels are created or updated in place.
import { parseArgs } from 'node:util';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HUB_ROOT, DIRS, loadConfig, saveConfig, HubError } from './lib/hub.mjs';
import { gitTry } from './lib/git.mjs';
import { requireGh, slugFromUrl, ensureLabels, STATIC_LABELS, repoLabel, epicLabel } from './lib/github.mjs';

try {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { 'hub-repo': { type: 'string' } } });
  requireGh();
  const cfg = loadConfig(HUB_ROOT);
  const hubRepo = values['hub-repo'] || cfg.github.hubRepo || slugFromUrl(gitTry(HUB_ROOT, ['remote', 'get-url', 'origin']).out);
  if (!hubRepo) throw new HubError('cannot tell the hub\'s GitHub repository from its origin remote; pass --hub-repo owner/name');
  for (const r of cfg.repos) {
    r.github ||= slugFromUrl(gitTry(join(HUB_ROOT, r.path), ['remote', 'get-url', 'origin']).out);
    if (!r.github) throw new HubError(`cannot tell the GitHub repository of ${r.path}; set "github": "owner/name" for it in hub.config.json`);
  }
  const epicsDir = join(HUB_ROOT, DIRS.epics);
  // An epic is a folder, docs/epics/<slug>/, holding its README.md.
  const epics = existsSync(epicsDir) ? readdirSync(epicsDir).filter((f) => existsSync(join(epicsDir, f, 'README.md'))) : [];
  const labels = [...STATIC_LABELS, ...cfg.repos.map((r) => repoLabel(r.name)), ...epics.map(epicLabel)];
  ensureLabels(hubRepo, labels);
  cfg.github = { enabled: true, hubRepo };
  saveConfig(HUB_ROOT, cfg);
  console.log(`[gh] GitHub mode on; tracking issues live in ${hubRepo}
[gh] ${labels.length} labels created or updated in ${hubRepo}
[gh] product repositories: ${cfg.repos.map((r) => `${r.name} → ${r.github}`).join(', ') || 'none yet'}
[gh] remaining one-time settings (docs/GITHUB.md): squash merges with "Pull request title and description",
     delete branches on merge, protect main, and the Project's built-in workflows.`);
} catch (e) {
  console.error(`[gh] ${e.message}`);
  process.exit(1);
}
