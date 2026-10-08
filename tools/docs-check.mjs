#!/usr/bin/env node
// Deterministic checks over the hub's documents and the product code they describe.
// Every rule here is described for humans in docs/WORKFLOW.md ("What `pnpm check` enforces").
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HUB_ROOT, DIRS, loadConfig, loadAdrs, loadAcDefinitions, loadWork, read, mdFiles } from './lib/hub.mjs';
import { splitFrontmatter, stripCode, codeSpans, links, headings, section } from './lib/markdown.mjs';
import {
  SPEC_STATUSES, ADR_STATUSES, SPIKE_STATUSES, ADR_REF_RE, adrLabel, TEST_TITLE_AC_RE, isAcId,
  parsePlanBranch, specPath, SLUG_RE, REQ_DEFINITION_RE, REQ_REF_RE,
} from './lib/conventions.mjs';
import { parsePlan } from './lib/plans.mjs';
import { matchesAny, globToRegExp } from './lib/glob.mjs';
import { gitTry, lsFiles } from './lib/git.mjs';

const SKIP_ANYWHERE = new Set(['.git', 'node_modules']);
const SKIP_TOP = new Set(['repos', '.worktrees', '.reviews', 'graphify-out', '.superpowers']);
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const LIVING = (rel) =>
  rel.startsWith(`${DIRS.features}/`) || rel.startsWith(`${DIRS.codebases}/`) || rel.startsWith(`${DIRS.contracts}/`) ||
  ['docs/ARCHITECTURE.md', 'docs/ONBOARDING.md', 'docs/WORKFLOW.md', 'README.md', 'AGENTS.md', 'CLAUDE.md'].includes(rel);

export function allMarkdown(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${name.name}` : name.name;
      if (name.isDirectory()) {
        if (!SKIP_ANYWHERE.has(name.name) && !(dir === '' && SKIP_TOP.has(name.name)) && rel !== DIRS.templates) walk(rel);
      } else if (name.name.endsWith('.md')) out.push(rel);
    }
  };
  walk('');
  // Files git ignores (.gitignore, or a person's own .git/info/exclude) are not hub documents;
  // untracked files that are not ignored, such as a spec not yet committed, are checked.
  const listed = gitTry(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (!listed.ok) return out.sort();
  const known = new Set(listed.out.split('\0'));
  return out.filter((f) => known.has(f)).sort();
}

export function runChecks(root = HUB_ROOT) {
  const errors = [];
  const err = (file, line, rule, message) => errors.push({ file, line, rule, message });
  const cfg = loadConfig(root);
  const files = allMarkdown(root);
  const texts = new Map(files.map((f) => [f, read(root, f)]));
  const adrs = loadAdrs(root);
  const acDefs = loadAcDefinitions(root);
  const repoNames = new Set(cfg.repos.map((r) => r.name));

  // A repository that is not checked out is reported once by checkRepos; paths into it are skipped
  // so one missing checkout does not bury that message under every path that cites it.
  const missingRepos = cfg.repos.filter((r) => !existsSync(join(root, r.path, '.git'))).map((r) => `${r.path}/`);

  checkFrontmatter(files, texts, repoNames, err);
  checkLinks(root, files, texts, err, missingRepos);
  checkCodePaths(root, files, texts, err, missingRepos);
  checkPlaceholders(files, texts, err);
  checkAdrRefs(files, texts, adrs, err);
  checkWork(root, cfg, err);
  const repoState = checkRepos(root, cfg, err);
  checkAcceptanceCriteria(root, cfg, repoState, acDefs, err);
  checkCodeAdrRefs(root, cfg, repoState, adrs, err);
  checkArchitecture(root, cfg, repoState, texts, adrs, err);
  checkContracts(root, cfg, files, texts, err);
  checkEpics(root, files, texts, err);
  return errors;
}

// ── frontmatter & locations ─────────────────────────────────────────────────

function checkFrontmatter(files, texts, repoNames, err) {
  for (const rel of files) {
    const text = texts.get(rel);
    const fm = splitFrontmatter(text);
    if (fm.error) {
      err(rel, 1, 'frontmatter', fm.error);
      continue;
    }
    const spec = expectedFrontmatter(rel, repoNames);
    if (spec.error) {
      err(rel, 1, 'location', spec.error);
      continue;
    }
    if (spec.none) {
      if (fm.has && spec.forbid) err(rel, 1, 'frontmatter', 'plans carry no frontmatter; the Superpowers header holds their metadata');
      continue;
    }
    if (!fm.has) {
      err(rel, 1, 'frontmatter', `missing frontmatter (expected type: ${spec.type})`);
      continue;
    }
    const allowed = new Set(['type', ...(spec.statuses ? ['status'] : []), ...(spec.paths ? ['paths'] : []), ...(spec.extra || [])]);
    for (const k of Object.keys(fm.data)) if (!allowed.has(k)) err(rel, 1, 'frontmatter', `unknown field "${k}" (allowed: ${[...allowed].join(', ')})`);
    if (fm.data.type !== spec.type) err(rel, 1, 'frontmatter', `type must be "${spec.type}" here, found "${fm.data.type ?? ''}"`);
    if (spec.statuses && !spec.statuses.includes(fm.data.status)) {
      err(rel, 1, 'frontmatter', `status must be one of ${spec.statuses.join(' | ')}, found "${fm.data.status ?? ''}"`);
    }
    if (spec.paths) {
      const paths = fm.data.paths;
      if (!Array.isArray(paths) || paths.length === 0) err(rel, 1, 'frontmatter', 'architecture areas need a non-empty `paths` list');
      else for (const p of paths) if (!p.startsWith(`repos/${spec.repo}/`)) err(rel, 1, 'frontmatter', `path "${p}" must start with repos/${spec.repo}/`);
    }
    if (spec.type === 'adr') {
      const num = rel.split('/').pop().slice(0, 4);
      const h1 = headings(text).find((h) => h.level === 1);
      if (!h1 || !h1.title.startsWith(`${adrLabel(num)}: `)) err(rel, h1?.line ?? 1, 'adr', `first heading must start with "${adrLabel(num)}: "`);
    }
  }
}

function expectedFrontmatter(rel, repoNames) {
  const base = rel.split('/').pop();
  const parts = rel.split('/');
  if (parts.length === 1 || (parts[0] === 'docs' && parts.length === 2) || parts[0] === '.claude') return { none: true };
  if (parts[0] !== 'docs') return { none: true };
  const dir = parts.slice(0, -1).join('/');
  if (dir === DIRS.features) return { type: 'feature' };
  if (parts[1] === 'epics') {
    if (parts.length === 4 && SLUG_RE.test(parts[2])) {
      if (base === 'README.md') return { type: 'epic', statuses: SPEC_STATUSES, extra: ['issue'] };
      if (base === 'prd.md') return { type: 'prd' };
    }
    return { error: 'an epic lives in docs/epics/<slug>/ as README.md (the technical design) and prd.md (the product requirements)' };
  }
  if (dir === DIRS.contracts) {
    if (!SLUG_RE.test(base.replace(/\.md$/, ''))) return { error: 'contracts are named <slug>.md' };
    return { type: 'contract', extra: ['provider', 'consumers'] };
  }
  if (dir === DIRS.specs) {
    if (!/^\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*-design\.md$/.test(base)) return { error: 'design specs are named <6-digit id>-<slug>-design.md (allocate the id with `pnpm plan:new`)' };
    return { type: 'design', statuses: SPEC_STATUSES };
  }
  if (dir === DIRS.plans) {
    if (!/^\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(base)) return { error: 'plans are named <6-digit id>-<slug>--<repo>.md (allocate the id with `pnpm plan:new`)' };
    return { none: true, forbid: true };
  }
  if (dir === DIRS.adr) {
    if (!/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(base)) return { error: 'ADRs are named NNNN-<slug>.md (four digits)' };
    return { type: 'adr', statuses: ADR_STATUSES };
  }
  if (dir === DIRS.spikes) {
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(base)) return { error: 'spike notes are named YYYY-MM-DD-<slug>.md' };
    return { type: 'spike', statuses: SPIKE_STATUSES };
  }
  if (parts[1] === 'codebases' && parts.length >= 4) {
    const repo = parts[2];
    if (!repoNames.has(repo)) return { error: `docs/codebases/${repo}/ does not match a repo in hub.config.json` };
    if (parts.length === 4 && base === 'ARCHITECTURE.md') return { type: 'architecture' };
    if (parts.length === 5 && parts[3] === 'architecture') return { type: 'architecture-area', paths: true, repo };
  }
  return { error: 'documents live only in the locations listed in docs/WORKFLOW.md ("Where things live")' };
}

// ── links, code paths, placeholders, ADR references ─────────────────────────

function checkLinks(root, files, texts, err, missingRepos) {
  for (const rel of files) {
    for (const { target, line } of links(texts.get(rel))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const clean = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (!clean) continue;
      const abs = clean.startsWith('/') ? join(root, clean) : resolve(root, dirname(rel), clean);
      if (missingRepos.some((m) => abs.startsWith(join(root, m)))) continue;
      if (!existsSync(abs)) err(rel, line, 'links', `link target "${target}" does not exist`);
    }
  }
}

function checkCodePaths(root, files, texts, err, missingRepos) {
  for (const rel of files.filter(LIVING)) {
    for (const { code, line } of codeSpans(texts.get(rel))) {
      if (!/^(repos|docs|tools)\/[^\s<>{}*?…]+$/.test(code)) continue;
      const [path, ...symbols] = code.split('::');
      // Only file-like (has an extension) or directory-like (trailing slash) spans; this skips branch names.
      if (!/\.[A-Za-z0-9]+$/.test(path) && !path.endsWith('/')) continue;
      if (missingRepos.some((m) => path.startsWith(m))) continue;
      const abs = join(root, path);
      if (!existsSync(abs)) {
        err(rel, line, 'code-paths', `\`${path}\` does not exist`);
        continue;
      }
      if (symbols.length && statSync(abs).isFile()) {
        const src = readFileSync(abs, 'utf8');
        for (const s of symbols) {
          const name = s.replace(/\(\)$/, '');
          if (!new RegExp(`\\b${name.replace(/[$.]/g, '\\$&')}\\b`).test(src)) err(rel, line, 'code-paths', `symbol "${name}" not found in \`${path}\``);
        }
      }
    }
  }
}

const PLACEHOLDERS = [/\bTBD\b/, /\bTODO\b/, /\bFIXME\b/, /\[insert/i, /insert here/i, /lorem ipsum/i];
function checkPlaceholders(files, texts, err) {
  for (const rel of files) {
    stripCode(texts.get(rel))
      .split('\n')
      .forEach((line, i) => {
        const hit = PLACEHOLDERS.find((re) => re.test(line));
        if (hit) err(rel, i + 1, 'placeholders', `placeholder text matches ${hit}`);
      });
  }
}

function checkAdrRefs(files, texts, adrs, err) {
  for (const rel of files) {
    stripCode(texts.get(rel))
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(ADR_REF_RE)) {
          if (!adrs.has(adrLabel(m[1]))) err(rel, i + 1, 'adr-refs', `${m[0]} has no file in docs/adr/`);
        }
      });
  }
}

// ── specs and plans ─────────────────────────────────────────────────────────

// A design spec, once approved, lists the living documents its work will change; once done, every
// item is ticked and every document it names exists.
function checkDocImpact(root, rel, err) {
  const text = read(root, rel);
  const status = splitFrontmatter(text).data.status;
  if (!['approved', 'in-progress', 'done'].includes(status)) return;
  const impact = section(text, 'Documentation impact');
  if (!impact) {
    err(rel, 1, 'doc-impact', 'approved specs need a "## Documentation impact" section listing the living documents the work changes (or "- None: <why>")');
    return;
  }
  const lines = impact.text.split('\n');
  const items = lines.filter((l) => /^- \[( |x|X)\]/.test(l));
  if (items.length === 0 && !lines.some((l) => /^- None:/.test(l))) {
    err(rel, impact.startLine, 'doc-impact', 'list each document as "- [ ] `docs/…`: what changes", or write "- None: <why>"');
  }
  if (status !== 'done') return;
  items.forEach((l) => {
    const line = impact.startLine + lines.indexOf(l);
    if (!/^- \[(x|X)\]/.test(l)) err(rel, line, 'doc-impact', 'the work is done but this documentation item is not ticked: update the document, then tick it');
    for (const m of l.matchAll(/`(docs\/[^`\s]+\.md)`/g)) if (!existsSync(join(root, m[1]))) err(rel, line, 'doc-impact', `\`${m[1]}\` does not exist`);
  });
}

function checkWork(root, cfg, err) {
  for (const w of loadWork(root).values()) {
    for (const sp of w.specs) checkDocImpact(root, sp.file, err);
    if (w.specs.length > 1) for (const s of w.specs.slice(1)) err(s.file, 1, 'ids', `ID ${w.id} is already used by ${w.specs[0].file}; renumber with \`pnpm plan:new\``);
    const spec = w.specs[0];
    for (const p of w.plans) {
      const text = read(root, p.file);
      if (!spec) {
        err(p.file, 1, 'ids', `no design spec with ID ${p.id}`);
        continue;
      }
      if (p.slug !== spec.slug) err(p.file, 1, 'ids', `slug "${p.slug}" differs from its spec's slug "${spec.slug}"`);
      const repo = cfg.repos.find((r) => r.name === p.repo);
      if (!repo) {
        err(p.file, 1, 'plans', `repo "${p.repo}" is not in hub.config.json`);
        continue;
      }
      checkPlan(root, p, text, repo, err);
    }
  }
}

function checkPlan(root, p, text, repo, err) {
  const plan = parsePlan(text);
  if (!plan.spec) err(p.file, 1, 'plans', 'header needs **Spec:** with a link to the design spec');
  else if (resolve(root, dirname(p.file), plan.spec) !== resolve(root, specPath(p.id, p.slug))) {
    err(p.file, 1, 'plans', `**Spec:** must link to ${specPath(p.id, p.slug)}`);
  }
  if (plan.repoPath !== repo.path) err(p.file, 1, 'plans', `header needs **Repo:** \`${repo.path}\``);
  const b = parsePlanBranch(plan.branch || '');
  if (!b || b.id !== p.id || b.slug !== p.slug) err(p.file, 1, 'plans', `header needs **Branch:** \`<type>/${p.id}-${p.slug}\``);
  if (plan.tasks.length === 0) err(p.file, 1, 'plans', 'plan has no "### Task N:" sections');
  plan.tasks.forEach((t, i) => {
    if (t.number !== i + 1) err(p.file, t.line, 'plans', `tasks must be numbered 1..N in order; found Task ${t.number} at position ${i + 1}`);
    if (t.checkboxes.length === 0) err(p.file, t.line, 'plans', `Task ${t.number} has no "- [ ]" steps`);
  });
  for (const t of plan.tasks) {
    const shouldBeChecked = !!plan.completion && !plan.deferred.has(t.number);
    for (const c of t.checkboxes) {
      if (c.checked !== shouldBeChecked) {
        err(p.file, c.line, 'progress', plan.completion
          ? `Task ${t.number} is ${plan.deferred.has(t.number) ? 'deferred and must stay unchecked' : 'complete and must be checked'}`
          : 'checkboxes are ticked only by `pnpm plan:complete`; in-flight progress is shown by `pnpm plan:status`');
        break;
      }
    }
  }
  if (plan.completion) {
    if (!plan.completion.hasRulings) err(p.file, plan.completion.line, 'completion', 'Completion needs a "### Rulings" section');
    if (plan.merged.length === 0) err(p.file, plan.completion.line, 'completion', 'Completion needs a **Merged:** `repos/<name>@<sha>` line');
    const repoDir = join(root, repo.path);
    for (const m of plan.merged) {
      if (m.path !== repo.path) err(p.file, plan.completion.line, 'completion', `**Merged:** names ${m.path}, plan targets ${repo.path}`);
      else if (existsSync(join(repoDir, '.git'))) {
        if (!gitTry(repoDir, ['cat-file', '-e', `${m.sha}^{commit}`]).ok) {
          err(p.file, plan.completion.line, 'completion', `commit ${m.sha} is missing from ${repo.path}; run \`git -C ${repo.path} fetch\``);
        } else if (!gitTry(repoDir, ['merge-base', '--is-ancestor', m.sha, 'HEAD']).ok) {
          err(p.file, plan.completion.line, 'completion', `${repo.path} is checked out before ${m.sha.slice(0, 12)}; the submodule pointer must include completed work`);
        }
      }
    }
  }
}

// ── product repos ───────────────────────────────────────────────────────────

function checkRepos(root, cfg, err) {
  const gitmodules = existsSync(join(root, '.gitmodules')) ? readFileSync(join(root, '.gitmodules'), 'utf8') : '';
  const state = new Map();
  for (const r of cfg.repos) {
    const dir = join(root, r.path);
    if (!new RegExp(`^\\s*path\\s*=\\s*${r.path.replace(/[.]/g, '\\.')}\\s*$`, 'm').test(gitmodules)) {
      err('hub.config.json', 1, 'repos', `${r.path} is not a submodule in .gitmodules (add repos with \`pnpm repo:add\`)`);
    }
    if (!existsSync(join(dir, '.git'))) {
      err('hub.config.json', 1, 'repos', `${r.path} is not checked out; run \`pnpm hub:setup\``);
      state.set(r.name, null);
      continue;
    }
    // The index holds the pointer the next commit records; the checkout must match it, or the
    // documents would be checked against code the commit does not point at.
    const staged = /^160000 ([0-9a-f]+) /.exec(gitTry(root, ['ls-files', '-s', '--', r.path]).out);
    const head = gitTry(dir, ['rev-parse', 'HEAD']).out;
    if (staged && staged[1] !== head) {
      err('hub.config.json', 1, 'repos', `${r.path} is checked out at ${head.slice(0, 12)} but the hub points at ${staged[1].slice(0, 12)}; run \`git submodule update\` (or stage the new pointer)`);
    }
    state.set(r.name, { dir, files: lsFiles(dir) });
  }
  return state;
}

function checkAcceptanceCriteria(root, cfg, repoState, acDefs, err) {
  for (const [id, defs] of acDefs) {
    const features = defs.filter((d) => d.kind === 'feature');
    if (features.length > 1) for (const d of features.slice(1)) err(d.file, d.line, 'ac', `${id} is already defined in ${features[0].file}:${features[0].line}`);
  }
  const tested = new Set();
  for (const r of cfg.repos) {
    const st = repoState.get(r.name);
    if (!st) continue;
    for (const f of st.files.filter((f) => matchesAny(f, r.tests))) {
      readFileSync(join(st.dir, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(TEST_TITLE_AC_RE)) {
            if (!isAcId(m[1])) continue;
            tested.add(m[1]);
            if (!acDefs.has(m[1])) err(`${r.path}/${f}`, i + 1, 'ac', `test cites ${m[1]}, which no feature or design spec defines`);
          }
        });
    }
  }
  if (cfg.repos.every((r) => repoState.get(r.name))) {
    for (const [id, defs] of acDefs) {
      const feature = defs.find((d) => d.kind === 'feature');
      if (feature && !tested.has(id)) err(feature.file, feature.line, 'ac', `${id} has no test whose title starts with "${id}:" in any configured repo`);
    }
  }
}

function checkCodeAdrRefs(root, cfg, repoState, adrs, err) {
  for (const r of cfg.repos) {
    const st = repoState.get(r.name);
    if (!st) continue;
    for (const f of st.files.filter((f) => CODE_EXT.test(f))) {
      const text = readFileSync(join(st.dir, f), 'utf8');
      if (!text.includes('ADR-')) continue;
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(ADR_REF_RE)) if (!adrs.has(adrLabel(m[1]))) err(`${r.path}/${f}`, i + 1, 'adr-refs', `${m[0]} has no file in docs/adr/`);
      });
    }
  }
}

// ── architecture ────────────────────────────────────────────────────────────

function checkArchitecture(root, cfg, repoState, texts, adrs, err) {
  const system = 'docs/ARCHITECTURE.md';
  const systemText = texts.get(system);
  if (!systemText) {
    err(system, 1, 'architecture', 'docs/ARCHITECTURE.md is missing');
    return;
  }
  const systemTargets = new Set(links(systemText).map((l) => resolve(root, 'docs', l.target.split('#')[0])));
  const evolution = section(systemText, 'Evolution');
  if (!evolution) err(system, 1, 'architecture', 'needs an "## Evolution" section listing accepted ADRs');
  else {
    const evoTargets = new Set(links(evolution.text).map((l) => resolve(root, 'docs', l.target.split('#')[0])));
    for (const [label, a] of adrs) {
      if (['accepted', 'superseded'].includes(a.status) && !evoTargets.has(resolve(root, a.file))) {
        err(system, evolution.startLine, 'architecture', `Evolution must link ${label} (${a.file})`);
      }
    }
  }

  for (const r of cfg.repos) {
    const map = `${DIRS.codebases}/${r.name}/ARCHITECTURE.md`;
    if (!texts.has(map)) {
      err(map, 1, 'architecture', `missing; copy docs/templates/REPO-ARCHITECTURE.md to ${map} and describe ${r.path}`);
      continue;
    }
    if (!systemTargets.has(resolve(root, map))) err(system, 1, 'architecture', `must link ${map}`);
    const st = repoState.get(r.name);
    if (!st) continue;

    const areaFiles = mdFiles(root, `${DIRS.codebases}/${r.name}/architecture`);
    const areaGlobs = [];
    for (const a of areaFiles) {
      const paths = splitFrontmatter(texts.get(a) || '').data.paths;
      if (!Array.isArray(paths)) continue;
      const repoRel = paths.map((p) => p.slice(r.path.length + 1));
      areaGlobs.push(...repoRel);
      for (const g of repoRel) if (!st.files.some((f) => globToRegExp(g).test(f))) err(a, 1, 'architecture', `paths glob "${r.path}/${g}" matches no file; the area doc is stale`);
    }
    const mentioned = new Set();
    for (const doc of [map, ...areaFiles]) {
      for (const { code } of codeSpans(texts.get(doc) || '')) mentioned.add(code.split('::')[0]);
    }
    for (const f of st.files.filter((f) => matchesAny(f, r.mustDocument))) {
      const hubPath = `${r.path}/${f}`;
      if (!mentioned.has(hubPath) && !matchesAny(f, areaGlobs)) {
        err(map, 1, 'architecture', `\`${hubPath}\` is a structural file (mustDocument) that no architecture doc mentions or covers with \`paths\``);
      }
    }
  }
}

// ── contracts ───────────────────────────────────────────────────────────────

function checkContracts(root, cfg, files, texts, err) {
  const contracts = files.filter((f) => f.startsWith(`${DIRS.contracts}/`));
  const system = texts.get('docs/ARCHITECTURE.md') || '';
  const linked = new Set(links(system).map((l) => resolve(root, 'docs', l.target.split('#')[0])));
  const repos = new Map(cfg.repos.map((r) => [r.name, r]));
  for (const rel of contracts) {
    const fm = splitFrontmatter(texts.get(rel)).data;
    const consumers = Array.isArray(fm.consumers) ? fm.consumers : [];
    const sides = [fm.provider, ...consumers].filter(Boolean);
    if (!fm.provider || consumers.length === 0) err(rel, 1, 'contracts', 'contracts need `provider: <repo>` and a non-empty `consumers` list');
    const cited = new Set(codeSpans(texts.get(rel)).map((c) => c.code.split('/')[1]).filter(Boolean));
    for (const name of sides) {
      if (!repos.has(name)) err(rel, 1, 'contracts', `"${name}" is not a repo in hub.config.json`);
      else if (!cited.has(name)) err(rel, 1, 'contracts', `cite the code that implements this contract in ${name}, as a backticked \`repos/${name}/…\` path`);
    }
    if (!linked.has(resolve(root, rel))) err('docs/ARCHITECTURE.md', 1, 'contracts', `link ${rel} from "How the repositories interact"`);
  }
}

// ── epics ───────────────────────────────────────────────────────────────────

function checkEpics(root, files, texts, err) {
  const epics = files.filter((f) => /^docs\/epics\/[^/]+\/README\.md$/.test(f));
  for (const rel of epics) {
    const dir = dirname(rel);
    const prdRel = `${dir}/prd.md`;
    const text = texts.get(rel);
    const status = splitFrontmatter(text).data.status;
    const reqs = new Set([...(texts.get(prdRel) || '').matchAll(REQ_DEFINITION_RE)].map((m) => m[1]));
    if (!texts.has(prdRel)) err(rel, 1, 'epics', `missing ${prdRel}: store the product requirements next to the design`);
    const map = section(text, 'Requirement map');
    if (!map) err(rel, 1, 'epics', 'needs a "## Requirement map" section: every REQ-n of the PRD mapped to a phase or marked out of scope');
    else {
      const mapped = new Set(map.text.match(REQ_REF_RE) || []);
      for (const r of reqs) if (!mapped.has(r)) err(rel, map.startLine, 'epics', `${r} from the PRD is not in the requirement map`);
      for (const r of mapped) if (!reqs.has(r)) err(rel, map.startLine, 'epics', `${r} is not defined in ${prdRel}`);
    }
    const phases = section(text, 'Phases');
    if (!phases) err(rel, 1, 'epics', 'needs a "## Phases" table');
    else if (status === 'done') {
      for (const row of phases.text.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l))) {
        const link = /\]\(([^)\s]+-design\.md)\)/.exec(row);
        if (!link) {
          err(rel, phases.startLine, 'epics', `the epic is done but phase "${row.split('|')[2]?.trim()}" links no design spec`);
          continue;
        }
        const spec = resolve(root, dir, link[1]);
        const st = existsSync(spec) ? splitFrontmatter(readFileSync(spec, 'utf8')).data.status : null;
        if (!['done', 'abandoned'].includes(st)) err(rel, phases.startLine, 'epics', `the epic is done but ${link[1]} is "${st ?? 'missing'}"`);
      }
    }
  }
  // Specs that belong to an epic may only cite requirements that epic defines.
  for (const rel of files.filter((f) => f.startsWith(`${DIRS.specs}/`))) {
    const text = texts.get(rel);
    const linksSec = section(text, 'Links');
    const epicLink = linksSec && /- Epic:.*?\]\(([^)\s]+README\.md)\)/.exec(linksSec.text);
    if (!epicLink) continue;
    const prd = resolve(root, dirname(rel), dirname(epicLink[1]), 'prd.md');
    const defined = new Set(existsSync(prd) ? [...readFileSync(prd, 'utf8').matchAll(REQ_DEFINITION_RE)].map((m) => m[1]) : []);
    for (const r of new Set(stripCode(text).match(REQ_REF_RE) || [])) if (!defined.has(r)) err(rel, 1, 'epics', `${r} is not defined in the epic's prd.md`);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let errors;
  try {
    errors = runChecks(HUB_ROOT);
  } catch (e) {
    console.error(`[check] ${e.message}`);
    process.exit(2);
  }
  if (errors.length === 0) {
    console.log('[check] ok');
    process.exit(0);
  }
  for (const e of errors) console.error(`${e.file}:${e.line}  [${e.rule}]  ${e.message}`);
  console.error(`\n[check] ${errors.length} problem(s). Rules: docs/WORKFLOW.md#what-pnpm-check-enforces`);
  process.exit(1);
}
