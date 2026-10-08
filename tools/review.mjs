#!/usr/bin/env node
// pnpm review:* commands: prepare a pull request for review with what the hub knows about it.
// See "Reviewing pull requests" in docs/WORKFLOW.md.
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HUB_ROOT, DIRS, loadConfig, repoConfig, loadWork, loadAdrs, loadAcDefinitions, HubError, skipGraphify, read, mdFiles } from './lib/hub.mjs';
import { git, gitTry, freshBase, showFile, hasRemote, logMessages } from './lib/git.mjs';
import { parsePlanBranch, footerValues, taskNumbers, specPath, adrLabel, ADR_REF_RE, TEST_TITLE_AC_RE, isAcId } from './lib/conventions.mjs';
import { splitFrontmatter, section } from './lib/markdown.mjs';
import { parsePlan } from './lib/plans.mjs';
import { splitCriteria } from './lib/features.mjs';
import { globToRegExp, matchesAny } from './lib/glob.mjs';
import { requireGh, viewPr, viewIssue } from './lib/github.mjs';
import { issueContext } from './lib/issue-text.mjs';

const root = HUB_ROOT;
const log = (s) => console.log(`[review] ${s}`);

function graphifyUpdate() {
  if (skipGraphify()) return;
  const r = spawnSync('graphify', ['update', '.'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) log('graph refreshed (graphify update .)');
  else console.warn(`[review] warning: \`graphify update .\` failed; the graph is stale until it succeeds:\n${(r.stderr || r.stdout).trim()}`);
}

const names = (repo, pr) => ({ wt: join(root, '.worktrees', `${repo.name}--review-${pr}`), out: join(root, '.reviews', `${repo.name}-${pr}`), ref: `refs/review/${pr}` });

function requirePr(pr) {
  if (!/^\d+$/.test(pr || '')) throw new HubError(`"${pr}" is not a pull request number`);
}

// A hub document from the working tree, or from the default branch when it is not checked out here.
function hubDoc(rel, cfg) {
  if (existsSync(join(root, rel))) return read(root, rel);
  return showFile(root, `origin/${cfg.defaultBranch}`, rel) || showFile(root, cfg.defaultBranch, rel);
}

function findPlan(id, repoName, cfg) {
  const local = loadWork(root).get(id)?.plans.find((p) => p.repo === repoName);
  if (local) return { rel: local.file, slug: local.slug };
  const listed = gitTry(root, ['ls-tree', '--name-only', `origin/${cfg.defaultBranch}:${DIRS.plans}`]).out.split('\n');
  const name = listed.find((n) => n.startsWith(`${id}-`) && n.endsWith(`--${repoName}.md`));
  return name ? { rel: `${DIRS.plans}/${name}`, slug: name.slice(7, -`--${repoName}.md`.length) } : null;
}

const titleOf = (text) => /^# (.+)$/m.exec(text || '')?.[1] || '';
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const code = (s) => `\`${s}\``;

// Acceptance-criteria IDs cited by test titles in the given files of a checkout.
function citedCriteria(dir, files) {
  const cited = new Map();
  for (const f of files) {
    const abs = join(dir, f);
    if (!existsSync(abs)) continue;
    for (const m of readFileSync(abs, 'utf8').matchAll(TEST_TITLE_AC_RE)) {
      if (!isAcId(m[1])) continue;
      if (!cited.has(m[1])) cited.set(m[1], new Set());
      cited.get(m[1]).add(f);
    }
  }
  return cited;
}

function plannedWork(id, repo, cfg, commits, wt, testFiles) {
  const out = [`### Planned work ${id}`, ''];
  const plan = findPlan(id, repo.name, cfg);
  if (!plan) return [...out, `No plan for ${code(repo.name)} with ID ${id} on the hub's ${cfg.defaultBranch}: ask the author which work this is.`].join('\n');
  const specRel = specPath(id, plan.slug);
  const specText = hubDoc(specRel, cfg) || '';
  const planText = hubDoc(plan.rel, cfg) || '';
  const parsed = parsePlan(planText);
  const done = new Set(commits.flatMap((c) => [...taskNumbers(c.body)]));
  const missing = parsed.tasks.filter((t) => !done.has(t.number));
  out.push(
    `- Design spec: ${code(specRel)} (status: ${splitFrontmatter(specText).data.status || 'unknown'})`,
    `- Plan: ${code(plan.rel)}`,
    `- Tasks with commits in this PR: ${parsed.tasks.length - missing.length} of ${parsed.tasks.length}${missing.length ? `; without a commit: ${missing.map((t) => `Task ${t.number} (${t.title})`).join(', ')}` : ''}`,
    '',
    '#### Review focus (from the plan)',
    '',
    section(planText, 'Review Focus')?.text.trim() || 'The plan has no `## Review Focus` section.',
    '',
    '#### Rulings (decisions the implementer made against the plan)',
    '',
  );
  const rulings = [...new Set(commits.flatMap((c) => footerValues(c.body, 'Ruling')))];
  out.push(rulings.length ? rulings.map((r) => `- ${r}`).join('\n') : '- None recorded.', '', '#### Acceptance criteria of the spec', '');
  const ac = section(specText, 'Acceptance criteria');
  const { added, removed } = ac ? splitCriteria(ac.text) : { added: [], removed: [] };
  const cited = citedCriteria(wt, testFiles);
  const refs = new Set(commits.flatMap((c) => footerValues(c.body, 'Refs').flatMap((v) => v.split(/[,\s]+/))));
  if (added.length === 0) out.push('The spec lists no acceptance criteria.');
  else {
    out.push(table(['Criterion', 'In the PR\'s `Refs:`', 'Tests at the PR\'s head citing it'], added.map((b) => [
      b.id, refs.has(b.id) ? 'yes' : 'no', cited.has(b.id) ? [...cited.get(b.id)].map(code).join(', ') : `none in ${repo.name}`,
    ])));
    out.push('', `A criterion with no test here may be proven in another repository's plan; check the plan's tasks before asking.`);
  }
  for (const b of removed) if (cited.has(b.id)) out.push(`- ${b.id} is retired by the spec but still cited by ${[...cited.get(b.id)].map(code).join(', ')}.`);
  return out.join('\n');
}

// Area documents whose `paths` cover a changed file, with the files they cover.
function governingAreas(repo, files) {
  const dir = `${DIRS.codebases}/${repo.name}/architecture`;
  const areas = [];
  for (const rel of mdFiles(root, dir)) {
    const globs = splitFrontmatter(read(root, rel)).data.paths;
    if (!Array.isArray(globs)) continue;
    const hit = files.filter((f) => globs.some((g) => globToRegExp(g).test(`${repo.path}/${f.path}`)));
    if (hit.length) areas.push({ rel, files: hit.map((f) => f.path) });
  }
  return areas;
}

function contractsOf(repo) {
  return mdFiles(root, DIRS.contracts).flatMap((rel) => {
    const fm = splitFrontmatter(read(root, rel)).data;
    const consumers = Array.isArray(fm.consumers) ? fm.consumers : [];
    if (fm.provider === repo.name) return [{ rel, role: `${repo.name} provides it to ${consumers.join(', ')}` }];
    if (consumers.includes(repo.name)) return [{ rel, role: `${repo.name} consumes it from ${fm.provider}` }];
    return [];
  });
}

function cmdStart(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [repoName, pr] = positionals;
  if (!repoName || !pr) throw new HubError('usage: pnpm review:start <repo> <pr-number>');
  requirePr(pr);
  const cfg = loadConfig(root);
  const repo = repoConfig(cfg, repoName);
  const repoDir = join(root, repo.path);
  if (!existsSync(join(repoDir, '.git'))) throw new HubError(`${repo.path} is not checked out; run \`pnpm hub:setup\``);
  if (!hasRemote(repoDir)) throw new HubError(`${repo.path} has no origin remote to fetch the pull request from`);

  let meta = null;
  if (cfg.github?.enabled && repo.github) {
    requireGh();
    meta = viewPr(repo.github, Number(pr));
  }
  const baseBranch = meta?.baseRefName || repo.defaultBranch;
  const { wt, out, ref } = names(repo, pr);
  const baseRef = freshBase(repoDir, baseBranch);
  const fetched = gitTry(repoDir, ['fetch', '--quiet', 'origin', `+refs/pull/${pr}/head:${ref}`]);
  if (!fetched.ok) throw new HubError(`cannot fetch pull request #${pr} of ${repo.path} (refs/pull/${pr}/head): ${fetched.err}`);
  const head = git(repoDir, ['rev-parse', ref]);
  if (existsSync(wt)) {
    if (git(wt, ['status', '--porcelain']) !== '') throw new HubError(`${wt} has local changes; a review worktree is read-only. Discard them and rerun.`);
    git(wt, ['checkout', '--quiet', '--detach', head]);
    log(`updated ${wt} to the PR's head ${head.slice(0, 12)}`);
  } else {
    git(repoDir, ['worktree', 'add', '--quiet', '--detach', wt, head]);
    log(`created ${wt} at the PR's head ${head.slice(0, 12)}`);
  }

  const mergeBase = git(repoDir, ['merge-base', baseRef, head]);
  const commits = logMessages(repoDir, ['--no-merges', '--reverse', `${mergeBase}..${head}`]);
  const files = git(repoDir, ['diff', '--name-status', '-M', mergeBase, head]).split('\n').filter(Boolean).map((l) => {
    const parts = l.split('\t');
    return { status: parts[0][0], path: parts[parts.length - 1] };
  });
  const diff = git(repoDir, ['diff', '--no-color', '-M', mergeBase, head]);
  const allTests = git(wt, ['ls-files']).split('\n').filter((f) => matchesAny(f, repo.tests));
  const changedTests = files.filter((f) => f.status !== 'D' && matchesAny(f.path, repo.tests)).map((f) => f.path);

  // The work this PR belongs to: a plan (from its commits' Plan: footers or its branch name), or the
  // issues its description says it fixes.
  const planIds = [...new Set(commits.flatMap((c) => footerValues(c.body, 'Plan')))];
  const fromBranch = parsePlanBranch(meta?.headRefName || '')?.id;
  if (planIds.length === 0 && fromBranch) planIds.push(fromBranch);
  const work = planIds.map((id) => plannedWork(id, repo, cfg, commits, wt, allTests));
  if (meta) {
    for (const m of (meta.body || '').matchAll(/\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+([\w.-]+\/[\w.-]+)?#(\d+)/gi)) {
      const issueRepo = m[1] || repo.github;
      work.push(`### Issue ${issueRepo}#${m[2]}\n\n${issueContext(viewIssue(issueRepo, Number(m[2])), issueRepo).replace(/^# /, '#### ').replace(/^## /gm, '##### ').replace(/^### /gm, '###### ')}`);
    }
  }

  // Documents that govern the changed code.
  const areas = governingAreas(repo, files);
  const contracts = contractsOf(repo);
  const adrs = loadAdrs(root);
  const cites = new Map();
  const cite = (text, where) => {
    for (const m of (text || '').matchAll(ADR_REF_RE)) {
      const label = adrLabel(m[1]);
      if (!cites.has(label)) cites.set(label, new Set());
      cites.get(label).add(where);
    }
  };
  cite(diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n'), 'the diff');
  for (const a of areas) cite(read(root, a.rel), code(a.rel));
  for (const id of planIds) {
    const plan = findPlan(id, repo.name, cfg);
    if (plan) cite(hubDoc(specPath(id, plan.slug), cfg), 'the design spec');
  }
  const map = `${DIRS.codebases}/${repo.name}/ARCHITECTURE.md`;
  const docs = [
    existsSync(join(root, map)) ? `- ${code(map)}: the repository's map, its invariants first` : `- ${code(map)} does not exist: the repository is not onboarded`,
    ...areas.map((a) => `- ${code(a.rel)}: covers ${a.files.map(code).join(', ')}`),
    ...contracts.map((c) => `- ${code(c.rel)}: ${c.role}`),
    ...[...cites].map(([label, where]) => {
      const adr = adrs.get(label);
      return adr ? `- ${label} ${code(adr.file)} (${adr.status}): ${titleOf(read(root, adr.file)).replace(/^ADR-\d+:\s*/, '')}; cited in ${[...where].join(', ')}`
        : `- ${label}: cited in ${[...where].join(', ')} but no such ADR exists in ${DIRS.adr}`;
    }),
  ];

  const defs = loadAcDefinitions(root);
  const changedCites = citedCriteria(wt, changedTests);
  const guidelines = repo.reviewGuidelines.map((g) => `- ${code(g)}${existsSync(join(root, g)) ? '' : ': missing, tell your human partner'}`);
  const rel = (p) => p.slice(root.length + 1);

  const context = [
    `# Review: ${repo.name} pull request #${pr}`,
    '',
    meta ? `**${meta.title}** (${meta.url}), branch ${code(meta.headRefName)}` : '',
    `Head ${code(head.slice(0, 12))} against ${code(baseRef)} (merge base ${code(mergeBase.slice(0, 12))}).`,
    `- Code at the PR's head (cite line numbers from here): ${code(rel(wt))}`,
    `- Diff: ${code(rel(join(out, 'pr.diff')))}`,
    `- Write the review to: ${code(rel(join(out, 'review.md')))}`,
    '',
    ...(meta ? ['## Description', '', (meta.body || '(no description)').trim(), ''] : []),
    '## Commits',
    '',
    commits.map((c) => `- ${code(c.sha.slice(0, 7))} ${c.subject}`).join('\n') || '- None beyond the base.',
    '',
    '## Changed files',
    '',
    table(['Status', 'File', 'Test'], files.map((f) => [f.status, code(f.path), changedTests.includes(f.path) ? 'yes' : ''])),
    '',
    '## The work this PR belongs to',
    '',
    work.length ? work.join('\n\n') : 'No plan or issue is linked: review it against its description and the documents below, and ask the author what it is for if that is unclear.',
    '',
    '## Documents that govern the changed code',
    '',
    docs.join('\n'),
    '',
    '## Acceptance criteria cited by the changed tests',
    '',
    changedCites.size
      ? table(['Criterion', 'Defined in', 'Tests'], [...changedCites].map(([id, fs]) => [id, defs.has(id) ? defs.get(id).map((d) => code(d.file)).join(', ') : '**not defined in the hub**', [...fs].map(code).join(', ')]))
      : 'None.',
    '',
    '## Team guidelines',
    '',
    guidelines.length ? guidelines.join('\n') : `None configured (\`reviewGuidelines\` for ${repo.name} in hub.config.json).`,
    '- `.claude/skills/review-pull-request/risk-checklist.md`: always',
    '',
  ].join('\n');

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'pr.diff'), diff + '\n');
  writeFileSync(join(out, 'context.md'), context.replace(/\n{3,}/g, '\n\n'));
  graphifyUpdate();
  console.log(`
  Review context: ${join(out, 'context.md')}
  Ask your agent to review it with the review-pull-request skill. It drafts; you post.
  When the review is done: pnpm review:cleanup ${repo.name} ${pr}`);
}

function cmdCleanup(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [repoName, pr] = positionals;
  if (!repoName || !pr) throw new HubError('usage: pnpm review:cleanup <repo> <pr-number>');
  requirePr(pr);
  const repo = repoConfig(loadConfig(root), repoName);
  const repoDir = join(root, repo.path);
  const { wt, out, ref } = names(repo, pr);
  if (existsSync(wt)) {
    const r = gitTry(repoDir, ['worktree', 'remove', wt]);
    if (!r.ok) throw new HubError(`${wt} was kept: ${r.err}\n  Discard its changes, then rerun.`);
    log(`removed ${wt}`);
  }
  gitTry(repoDir, ['update-ref', '-d', ref]);
  if (existsSync(out)) log(`kept ${out} (your notes); delete it when you no longer need them`);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { start: cmdStart, cleanup: cmdCleanup };
try {
  if (!commands[cmd]) throw new HubError(`unknown command "${cmd}"; see the Commands table in docs/WORKFLOW.md`);
  commands[cmd](rest);
} catch (e) {
  console.error(`[review] ${e.message}`);
  process.exit(1);
}
