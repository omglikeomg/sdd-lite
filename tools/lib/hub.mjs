import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_NAME_RE, AC_DEFINITION_RE, isAcId, adrLabel, parseSpecFilename, parsePlanFilename } from './conventions.mjs';
import { splitFrontmatter } from './markdown.mjs';

export const TOOLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HUB_ROOT = resolve(TOOLS_DIR, '..');
export const RUN_HOOK = join(TOOLS_DIR, 'git-hooks', 'run.mjs');

export const DIRS = {
  specs: 'docs/superpowers/specs',
  plans: 'docs/superpowers/plans',
  adr: 'docs/adr',
  features: 'docs/features',
  epics: 'docs/epics',
  spikes: 'docs/spikes',
  codebases: 'docs/codebases',
  contracts: 'docs/contracts',
  templates: 'docs/templates',
};

export class HubError extends Error {}

export function loadConfig(root = HUB_ROOT) {
  const file = join(root, 'hub.config.json');
  if (!existsSync(file)) throw new HubError(`missing ${file}`);
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.defaultBranch ??= 'main';
  cfg.github ??= { enabled: false, hubRepo: null };
  cfg.repos ??= [];
  for (const r of cfg.repos) {
    if (!REPO_NAME_RE.test(r.name)) throw new HubError(`hub.config.json: invalid repo name "${r.name}"`);
    r.path ??= `repos/${r.name}`;
    r.defaultBranch ??= 'main';
    r.tests ??= [];
    r.mustDocument ??= [];
    r.reviewGuidelines ??= [];
  }
  return cfg;
}

export function saveConfig(root, cfg) {
  writeFileSync(join(root, 'hub.config.json'), JSON.stringify(cfg, null, 2) + '\n');
}

export function repoConfig(cfg, name) {
  const r = cfg.repos.find((x) => x.name === name);
  if (!r) throw new HubError(`unknown repo "${name}" (configured: ${cfg.repos.map((x) => x.name).join(', ') || 'none'})`);
  return r;
}

export function mdFiles(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => `${dir}/${f}`);
}

export function read(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ADR-NNNN -> { file, status }
export function loadAdrs(root) {
  const adrs = new Map();
  for (const rel of mdFiles(root, DIRS.adr)) {
    const m = /^(\d{4})-/.exec(rel.split('/').pop());
    if (!m) continue;
    const fm = splitFrontmatter(read(root, rel));
    adrs.set(adrLabel(m[1]), { file: rel, status: fm.data.status });
  }
  return adrs;
}

// AC id -> [{ file, line, kind: 'feature' | 'design' }]
export function loadAcDefinitions(root) {
  const defs = new Map();
  const scan = (dir, kind) => {
    for (const rel of mdFiles(root, dir)) {
      // Criteria a spec retires (under "### Removed") are not definitions: tests citing them fail.
      let retired = false;
      read(root, rel)
        .split('\n')
        .forEach((line, i) => {
          const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
          if (h) retired = h[1].length === 3 && h[2] === 'Removed' ? true : h[1].length <= 3 ? false : retired;
          if (retired) return;
          for (const m of line.matchAll(AC_DEFINITION_RE)) {
            if (!isAcId(m[1])) continue;
            if (!defs.has(m[1])) defs.set(m[1], []);
            defs.get(m[1]).push({ file: rel, line: i + 1, kind });
          }
        });
    }
  };
  scan(DIRS.features, 'feature');
  scan(DIRS.specs, 'design');
  return defs;
}

// All specs and plans in the working tree, grouped by ID.
export function loadWork(root) {
  const work = new Map();
  const entry = (id) => {
    if (!work.has(id)) work.set(id, { id, specs: [], plans: [] });
    return work.get(id);
  };
  for (const rel of mdFiles(root, DIRS.specs)) {
    const p = parseSpecFilename(rel.split('/').pop());
    if (p) entry(p.id).specs.push({ ...p, file: rel });
  }
  for (const rel of mdFiles(root, DIRS.plans)) {
    const p = parsePlanFilename(rel.split('/').pop());
    if (p) entry(p.id).plans.push({ ...p, file: rel });
  }
  return work;
}

export function skipGraphify() {
  return process.env.HUB_SKIP_GRAPHIFY === '1';
}
