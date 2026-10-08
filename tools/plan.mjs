#!/usr/bin/env node
// pnpm plan:* and work:* commands — see the Commands table in docs/WORKFLOW.md.
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { HUB_ROOT, DIRS, loadConfig, repoConfig, loadWork, HubError, skipGraphify, read } from './lib/hub.mjs';
import { git, gitTry, freshBase, showFile, refExists, isAncestor, logMessages } from './lib/git.mjs';
import { SLUG_RE, ID_RE, parsePlanBranch, parsePlanFilename, planPath, specPath, worktreeDirName, taskNumbers, footerValues, branchNameError, commitHeaderError } from './lib/conventions.mjs';
import { splitFrontmatter, setFrontmatterValue, section, headings } from './lib/markdown.mjs';
import { parsePlan, tickTasks, rulingsFromLedger, completionSection } from './lib/plans.mjs';
import { copyLefthookLocal, hookSelfTest } from './lib/hooks.mjs';
import { criteriaByFeature, mergeCriteria, newFeatureDoc, splitCriteria, removeCriteria } from './lib/features.mjs';
import { explanationSections, fixPrBody, featurePrBody } from './lib/pr-text.mjs';
import { matchesAny } from './lib/glob.mjs';
import {
  STATUS, requireGh, parseIssueRef, openPrFor, closeIssue, closePr, removeLabels, addSubIssue, ensureLabels, epicLabel, createIssue, viewIssue, comment, addLabels, setStatus, createPr, editIssueBody as gh_editBody,
} from './lib/github.mjs';
import {
  trackingIssueBody, adoptedComment, abandonedComment, epicIssueBody, epicStartedComment, epicReadyComment, specReadyComment, codeReadyComment, completionComment, boundedStartedComment, boundedReadyComment, issueContext,
} from './lib/issue-text.mjs';

const root = HUB_ROOT;
const log = (s) => console.log(`[plan] ${s}`);

function graphifyUpdate() {
  if (skipGraphify()) return;
  const r = spawnSync('graphify', ['update', '.'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) log('graph refreshed (graphify update .)');
  else console.warn(`[plan] warning: \`graphify update .\` failed; the graph is stale until it succeeds:\n${(r.stderr || r.stdout).trim()}`);
}

// Submodule pointers are ignored: switching hub branches leaves submodule checkouts behind, and
// syncSubmodules() puts them back on the new branch's pointers.
function requireCleanHub() {
  if (git(root, ['status', '--porcelain', '--ignore-submodules=all']) !== '') {
    throw new HubError('the hub has uncommitted changes; commit or stash them first');
  }
}

// Check out each submodule at the pointer recorded on the current hub branch. Refuses rather than
// overwrite local changes in a submodule.
function syncSubmodules() {
  if (existsSync(join(root, '.gitmodules'))) git(root, ['submodule', 'update', '--init', '--quiet']);
}

// GitHub mode settings when enabled (and `gh` is ready), otherwise null.
function github(cfg) {
  if (!cfg.github?.enabled) return null;
  if (!cfg.github.hubRepo) throw new HubError('hub.config.json has github.enabled but no github.hubRepo; run pnpm gh:setup');
  requireGh();
  return cfg.github;
}

function idFor(number) {
  if (number > 999999) throw new HubError(`issue #${number} does not fit a six-digit work ID`);
  return String(number).padStart(6, '0');
}

function requireId(id) {
  if (!ID_RE.test(id || '')) throw new HubError(`"${id}" is not a 6-digit plan ID`);
}

// ── new ─────────────────────────────────────────────────────────────────────

export function nextId(base) {
  let max = 0;
  const seen = (name) => {
    for (const m of name.matchAll(/(?:^|[/-])(\d{6})-/g)) max = Math.max(max, Number(m[1]));
  };
  for (const dir of [DIRS.specs, DIRS.plans]) {
    if (existsSync(join(root, dir))) readdirSync(join(root, dir)).forEach(seen);
  }
  gitTry(root, ['ls-tree', '-r', '--name-only', base, '--', 'docs/superpowers']).out.split('\n').forEach(seen);
  git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']).split('\n').forEach(seen);
  return String(max + 1).padStart(6, '0');
}

function cmdNew(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { repos: { type: 'string' }, type: { type: 'string', default: 'feat' }, issue: { type: 'string' }, epic: { type: 'string' }, title: { type: 'string' } },
  });
  const [slug] = positionals;
  if (!slug || !SLUG_RE.test(slug)) throw new HubError('usage: pnpm plan:new <slug> --repos api,web [--type feat] [--issue <n>] [--epic <slug>] [--title "<issue title>"]');
  const cfg = loadConfig(root);
  const repos = (values.repos || '').split(',').filter(Boolean);
  if (repos.length === 0) throw new HubError('--repos is required (comma-separated repo names from hub.config.json)');
  repos.forEach((r) => repoConfig(cfg, r));
  const epicRel = values.epic ? `${DIRS.epics}/${values.epic}/README.md` : null;
  if (epicRel && !existsSync(join(root, epicRel))) throw new HubError(`no epic ${epicRel}; start one with pnpm epic:new ${values.epic}`);
  const g = github(cfg);
  if (values.issue && !g) throw new HubError('--issue needs GitHub mode (pnpm gh:setup)');
  requireCleanHub();
  const base = freshBase(root, cfg.defaultBranch);

  let id;
  if (g) {
    // The hub's tracking issue number is the work ID, so GitHub hands out IDs one at a time.
    const labels = ['tier:architectural', `type:${values.type}`, STATUS.ongoing, ...repos.map((r) => `repo:${r}`)];
    if (values.epic) {
      ensureLabels(g.hubRepo, [epicLabel(values.epic)]);
      labels.push(`epic:${values.epic}`);
    }
    let number;
    if (values.issue) {
      const ref = parseIssueRef(values.issue, g.hubRepo);
      if (ref.repo !== g.hubRepo) throw new HubError(`tracking issues live in the hub repository ${g.hubRepo}`);
      const issue = viewIssue(ref.repo, ref.number);
      if (issue.state !== 'OPEN') throw new HubError(`issue #${ref.number} is ${issue.state.toLowerCase()}`);
      number = ref.number;
    } else {
      const title = values.title || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      number = createIssue(g.hubRepo, title, trackingIssueBody({ id: idFor(0), slug, repos, type: values.type }), []).number;
    }
    id = idFor(number);
    if (loadWork(root).has(id) || gitTry(root, ['ls-tree', '-r', '--name-only', base, '--', 'docs/superpowers']).out.includes(`/${id}-`)) {
      throw new HubError(`work ${id} already exists in the hub; issue #${number} is already tracked`);
    }
    addLabels(g.hubRepo, number, labels);
    setStatus(g.hubRepo, number, STATUS.ongoing);
    if (values.issue) comment(g.hubRepo, number, adoptedComment({ id, slug, repos }), 'design-started');
    else gh_editBody(g.hubRepo, number, trackingIssueBody({ id, slug, repos, type: values.type }));
    const epicIssue = epicRel && Number(splitFrontmatter(read(root, epicRel)).data.issue);
    if (epicIssue) {
      if (addSubIssue(g.hubRepo, epicIssue, number)) log(`GitHub: #${number} is a sub-issue of epic #${epicIssue}`);
      else console.warn(`[plan] warning: GitHub refused to make #${number} a sub-issue of #${epicIssue}; the epic:${values.epic} label still groups them`);
    }
    log(`GitHub: issue ${g.hubRepo}#${number} tracks this work`);
  } else id = nextId(base);

  const branch = `docs/${id}-${slug}-spec`;
  try {
    git(root, ['switch', '--quiet', '--no-track', '-c', branch, base]);
  } catch (e) {
    if (g && !values.issue) throw new HubError(`${e.message}\n  Issue #${Number(id)} was created; rerun with --issue ${Number(id)} to continue with it.`);
    throw e;
  }
  syncSubmodules();
  log(`allocated ID ${id} and switched the hub to ${branch}`);
  console.log(`
  Design spec (brainstorming writes it here):  ${specPath(id, slug)}
${repos.map((r) => `  Plan for ${r} (writing-plans writes it here):  ${planPath(id, slug, r)}\n    plan header **Branch:** \`${values.type}/${id}-${slug}\``).join('\n')}

  Give these exact paths to superpowers:brainstorming and superpowers:writing-plans.
  Open the spec PR when the spec (status: approved) and plans pass \`pnpm check\`:
    git commit -m "docs(spec): ${id} ${slug}"
    pnpm plan:pr ${id} --spec${g ? ' --create' : ''}${epicRel ? `\n  Link the spec to its epic in "## Links": - Epic: [${values.epic}](../../epics/${values.epic}/README.md)` : ''}`);
}

// ── start ───────────────────────────────────────────────────────────────────

function findPlanAt(ref, id, repo) {
  const names = gitTry(root, ['ls-tree', '--name-only', `${ref}:${DIRS.plans}`]).out.split('\n');
  const name = names.find((n) => {
    const p = parsePlanFilename(n);
    return p && p.id === id && p.repo === repo;
  });
  return name ? { rel: `${DIRS.plans}/${name}`, ...parsePlanFilename(name) } : null;
}

// The repository's own lockfile decides the package manager.
const INSTALLERS = [
  ['pnpm-lock.yaml', 'pnpm', ['install', '--frozen-lockfile']],
  ['package-lock.json', 'npm', ['ci']],
  ['yarn.lock', 'yarn', ['install', '--frozen-lockfile']],
];

// Create (or resume) a worktree of a product repository on `branch`, branched from its freshly
// fetched default branch, install dependencies, and prove the hub's hooks run there.
function prepareWorktree({ repo, branch, dirName, planId, install }) {
  const repoDir = join(root, repo.path);
  if (!existsSync(join(repoDir, '.git'))) throw new HubError(`${repo.path} is not checked out; run \`pnpm hub:setup\``);
  const wt = join(root, '.worktrees', dirName);
  let created = false;
  if (!existsSync(wt)) {
    const base = freshBase(repoDir, repo.defaultBranch);
    if (refExists(repoDir, `refs/heads/${branch}`)) git(repoDir, ['worktree', 'add', '--quiet', wt, branch]);
    else {
      git(repoDir, ['worktree', 'add', '--quiet', '--no-track', '-b', branch, wt, base]);
      created = true;
    }
    copyLefthookLocal(repoDir, wt);
    log(`created ${wt} on ${branch}${created ? ` from fresh ${base}` : ' (existing branch)'}`);
  } else log(`resuming existing worktree ${wt}`);

  const installer = INSTALLERS.find(([lock]) => existsSync(join(wt, lock)));
  if (install && installer && !existsSync(join(wt, 'node_modules'))) {
    const [, cmd, cmdArgs] = installer;
    log(`installing dependencies (${cmd} ${cmdArgs.join(' ')})`);
    execFileSync(cmd, cmdArgs, { cwd: wt, stdio: 'inherit' });
  }
  const problems = hookSelfTest(wt, planId);
  if (problems.length) {
    if (created) {
      gitTry(repoDir, ['worktree', 'remove', '--force', wt]);
      gitTry(repoDir, ['branch', '-D', branch]);
    }
    throw new HubError(`hook self-test failed in ${repo.path}:\n  ${problems.join('\n  ')}\n  Run \`pnpm hub:setup\` and try again.`);
  }
  log('hook self-test passed (bad commit rejected, valid commit accepted)');
  return wt;
}

function cmdStart(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { repo: { type: 'string' }, 'no-install': { type: 'boolean', default: false } } });
  const [id] = positionals;
  requireId(id);
  const cfg = loadConfig(root);
  if (!values.repo) throw new HubError('--repo is required');
  const repo = repoConfig(cfg, values.repo);
  const hubBase = freshBase(root, cfg.defaultBranch);
  const found = findPlanAt(hubBase, id, repo.name);
  if (!found) throw new HubError(`no plan ${id} for ${repo.name} on ${hubBase}; merge the spec PR first`);
  const specText = showFile(root, hubBase, specPath(id, found.slug));
  const status = specText && splitFrontmatter(specText).data.status;
  if (!['approved', 'in-progress'].includes(status)) throw new HubError(`spec ${specPath(id, found.slug)} on ${hubBase} has status "${status}"; it must be approved`);
  const plan = parsePlan(showFile(root, hubBase, found.rel));
  const b = parsePlanBranch(plan.branch || '');
  if (!b || b.id !== id) throw new HubError(`${found.rel} has no valid **Branch:** line`);

  const g = github(cfg);
  const wt = prepareWorktree({ repo, branch: plan.branch, dirName: worktreeDirName(repo.name, id, found.slug), planId: id, install: !values['no-install'] });
  if (g) setStatus(g.hubRepo, Number(id), STATUS.ongoing);
  graphifyUpdate();
  const planAbs = join(root, found.rel);
  console.log(`
  Start the execution session in the worktree:
    cd ${wt}
    claude        # or: opencode

  Prompt:
    Execute the plan ${planAbs} with superpowers:subagent-driven-development
    (or superpowers:executing-plans). Follow its "Execution rules" section.`);
}

// ── status ──────────────────────────────────────────────────────────────────

function taskProgress(repoDir, repo, branch, id) {
  const defaultRef = refExists(repoDir, `origin/${repo.defaultBranch}`) ? `origin/${repo.defaultBranch}` : repo.defaultBranch;
  const done = new Set();
  const refs = new Set();
  const rulings = [];
  const record = (body) => {
    for (const n of taskNumbers(body)) done.add(n);
    for (const r of footerValues(body, 'Ruling')) if (!rulings.includes(r)) rulings.push(r);
    for (const v of footerValues(body, 'Refs')) for (const t of v.split(/[,\s]+/).filter(Boolean)) refs.add(t);
  };
  const merged = logMessages(repoDir, ['--grep', `^Plan: ${id}$`, defaultRef]);
  for (const c of merged) record(c.body);
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if (!refExists(repoDir, ref)) continue;
    for (const c of logMessages(repoDir, ['--no-merges', `${defaultRef}..${ref}`])) {
      if (footerValues(c.body, 'Plan').includes(id)) record(c.body);
    }
  }
  return { done, refs, rulings, merged, defaultRef };
}

function cmdStatus(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [only] = positionals;
  const cfg = loadConfig(root);
  const rows = [];
  const epics = existsSync(join(root, DIRS.epics)) ? readdirSync(join(root, DIRS.epics)) : [];
  for (const slug of epics.filter((f) => existsSync(join(root, DIRS.epics, f, 'README.md')))) {
    const text = read(root, `${DIRS.epics}/${slug}/README.md`);
    const phases = section(text, 'Phases');
    const rowsN = phases ? phases.text.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).length : 0;
    rows.push(`epic   ${slug}  [${splitFrontmatter(text).data.status}]  ${rowsN} phase(s)`);
  }
  for (const w of [...loadWork(root).values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (only && w.id !== only) continue;
    const spec = w.specs[0];
    const status = spec ? splitFrontmatter(read(root, spec.file)).data.status : 'no spec';
    rows.push(`${w.id} ${spec ? spec.slug : w.plans[0]?.slug}  [${status}]`);
    for (const p of w.plans) {
      const plan = parsePlan(read(root, p.file));
      const repo = cfg.repos.find((r) => r.name === p.repo);
      const repoDir = repo && join(root, repo.path);
      let state;
      if (plan.completion) state = 'complete';
      else if (!repoDir || !existsSync(join(repoDir, '.git'))) state = 'repo not checked out';
      else {
        const { done, merged } = taskProgress(repoDir, repo, plan.branch, w.id);
        const wt = existsSync(join(root, '.worktrees', worktreeDirName(p.repo, w.id, p.slug)));
        const phase = merged.length ? 'merged, awaiting plan:complete' : wt || done.size ? 'in progress' : 'not started';
        state = `${phase}, tasks ${[...done].filter((n) => plan.tasks.some((t) => t.number === n)).length}/${plan.tasks.length}`;
      }
      rows.push(`         ${p.repo.padEnd(12)} ${plan.branch || '(no branch)'}  ${state}`);
    }
  }
  console.log(rows.length ? rows.join('\n') : 'no epics, specs or plans yet');
}

// ── complete ────────────────────────────────────────────────────────────────

function docImpactTodo(specText) {
  const impact = section(specText, 'Documentation impact');
  const items = impact ? impact.text.split('\n').filter((l) => /^- \[ \]/.test(l)) : [];
  return items.length ? items.map((l) => `    ${l}`).join('\n') : '    (none)';
}

function cmdComplete(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { defer: { type: 'string', default: '' }, merged: { type: 'string', multiple: true, default: [] } } });
  const [id] = positionals;
  requireId(id);
  const cfg = loadConfig(root);
  requireCleanHub();
  const hubBase = freshBase(root, cfg.defaultBranch);
  const deferred = new Set(values.defer.split(',').filter(Boolean).map(Number));

  const names = gitTry(root, ['ls-tree', '--name-only', `${hubBase}:${DIRS.plans}`]).out.split('\n');
  const plans = names.map((n) => ({ n, p: parsePlanFilename(n) })).filter((x) => x.p && x.p.id === id);
  if (plans.length === 0) throw new HubError(`no plans with ID ${id} on ${hubBase}`);
  const slug = plans[0].p.slug;

  // Validate everything before touching any file.
  const work = plans.map(({ n, p }) => {
    const rel = `${DIRS.plans}/${n}`;
    const text = showFile(root, hubBase, rel);
    const plan = parsePlan(text);
    if (plan.completion) throw new HubError(`${rel} is already complete`);
    const repo = repoConfig(cfg, p.repo);
    const repoDir = join(root, repo.path);
    freshBase(repoDir, repo.defaultBranch);
    const progress = taskProgress(repoDir, repo, plan.branch, id);
    const { done, rulings: footerRulings } = progress;
    let { merged } = progress;
    // Escape hatch for a squash commit whose message lost its `Plan:` footer: --merged <repo>=<sha>.
    const given = values.merged.map((m) => m.split('=')).find(([r]) => r === p.repo);
    if (given) {
      const sha = gitTry(repoDir, ['rev-parse', '--verify', `${given[1]}^{commit}`]).out;
      if (!sha || !isAncestor(repoDir, sha, progress.defaultRef)) throw new HubError(`--merged ${p.repo}=${given[1]}: not a commit on ${progress.defaultRef}`);
      if (!merged.some((m) => m.sha === sha)) merged = [{ sha, subject: git(repoDir, ['log', '-1', '--format=%s', sha]), body: '' }, ...merged];
    }
    if (merged.length === 0) {
      throw new HubError(`no commit with "Plan: ${id}" on ${repo.path} ${repo.defaultBranch}. Merge the code PR first; ` +
        `if it is merged but its message lost the footer, pass --merged ${p.repo}=<squash commit sha>`);
    }
    const missing = plan.tasks.filter((t) => !done.has(t.number) && !deferred.has(t.number));
    if (missing.length) {
      throw new HubError(`${repo.path}: tasks without a "Task:" footer in merged or branch commits: ${missing.map((t) => t.number).join(', ')}. ` +
        'Finish them, or record them as deferred with --defer <n,...>.');
    }
    // Rulings live in `Ruling:` footers on the task commits; Superpowers deletes its ledger when the
    // final review is clean, so the ledger only adds rulings from a run that has not finished.
    const ledger = join(root, '.worktrees', worktreeDirName(p.repo, id, slug), '.superpowers', 'sdd', n.replace(/\.md$/, ''), 'progress.md');
    const ledgerRulings = existsSync(ledger) ? rulingsFromLedger(readFileSync(ledger, 'utf8')).map((r) => r.replace(/^Ruling:\s*/, '')) : [];
    const rulings = [...footerRulings, ...ledgerRulings.filter((r) => !footerRulings.includes(r))];
    return { rel, text, plan, repo, repoDir, done, merged, rulings, defaultRef: progress.defaultRef };
  });

  const specRel = specPath(id, slug);
  let featureMoves;
  try {
    featureMoves = [...criteriaByFeature(showFile(root, hubBase, specRel) || '').entries()].map(([link, blocks]) => {
      const rel = link.startsWith(`${DIRS.features}/`) ? link : posix.normalize(posix.join(posix.dirname(specRel), link));
      if (!rel.startsWith(`${DIRS.features}/`) || !rel.endsWith('.md')) throw new Error(`feature link "${link}" must point into ${DIRS.features}/`);
      return { rel, blocks };
    });
  } catch (e) {
    throw new HubError(`${specRel}: ${e.message}`);
  }

  // Criteria the spec retires must exist in a feature document today.
  const retiredIds = (() => {
    const ac = section(showFile(root, hubBase, specRel) || '', 'Acceptance criteria');
    return ac ? splitCriteria(ac.text).removed.map((b) => b.id) : [];
  })();
  const featureFiles = gitTry(root, ['ls-tree', '--name-only', `${hubBase}:${DIRS.features}`]).out.split('\n').filter((n) => n.endsWith('.md')).map((n) => `${DIRS.features}/${n}`);
  for (const rid of retiredIds) {
    if (!featureFiles.some((f) => (showFile(root, hubBase, f) || '').includes(`**${rid}**`))) {
      throw new HubError(`${specRel} retires ${rid}, but no feature document on ${hubBase} defines it`);
    }
  }

  const branch = `docs/${id}-${slug}-completion`;
  git(root, ['switch', '--quiet', '--no-track', '-c', branch, hubBase]);
  syncSubmodules();
  const date = new Date().toISOString().slice(0, 10);
  for (const w of work) {
    const doneTasks = new Set(w.plan.tasks.filter((t) => !deferred.has(t.number)).map((t) => t.number));
    // The pointer goes to the commit that brought the work into the default branch's first-parent
    // history: the squash commit itself, or the merge commit when PRs were merged with one.
    const introducing = w.merged.map((m) => gitTry(w.repoDir, ['rev-list', '--first-parent', '--ancestry-path', `${m.sha}..${w.defaultRef}`]).out.split('\n').filter(Boolean).pop() || m.sha);
    const newest = { sha: introducing.find((c) => introducing.every((o) => isAncestor(w.repoDir, o, c))) || introducing[0] };
    const body = tickTasks(w.text, doneTasks).replace(/\s*$/, '\n\n') + completionSection({
      date,
      merged: [...w.merged].reverse().map((m) => ({ path: w.repo.path, sha: m.sha, subject: m.subject })),
      rulings: w.rulings,
      deferred: w.plan.tasks.filter((t) => deferred.has(t.number)),
    });
    writeFileSync(join(root, w.rel), body);
    const current = git(w.repoDir, ['rev-parse', 'HEAD']);
    if (isAncestor(w.repoDir, current, newest.sha)) git(w.repoDir, ['checkout', '--quiet', '--detach', newest.sha]);
    else if (!isAncestor(w.repoDir, newest.sha, current)) throw new HubError(`${w.repo.path} HEAD ${current} and ${newest.sha} have diverged; check out the default branch tip and rerun`);
    git(root, ['add', w.rel, w.repo.path]);
    log(`${w.rel}: ${doneTasks.size}/${w.plan.tasks.length} tasks done, ${w.rulings.length} ruling(s), ${w.repo.path} -> ${git(w.repoDir, ['rev-parse', '--short=12', 'HEAD'])}`);
  }
  writeFileSync(join(root, specRel), setFrontmatterValue(read(root, specRel), 'status', 'done'));
  git(root, ['add', specRel]);
  for (const f of featureMoves) {
    const abs = join(root, f.rel);
    const title = f.rel.split('/').pop().replace(/\.md$/, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    writeFileSync(abs, mergeCriteria(existsSync(abs) ? readFileSync(abs, 'utf8') : newFeatureDoc(title, goalOf(read(root, specRel))), f.blocks));
    git(root, ['add', f.rel]);
    log(`${f.rel}: ${f.blocks.map((b) => b.id).join(', ')} now describe main`);
  }
  for (const rel of retiredIds.length ? featureFiles : []) {
    const r = removeCriteria(read(root, rel), retiredIds);
    if (!r.removed.length) continue;
    writeFileSync(join(root, rel), r.text);
    git(root, ['add', rel]);
    log(`${rel}: retired ${r.removed.join(', ')}; delete or retitle the tests that cited them`);
  }
  graphifyUpdate();
  console.log(`
  The hub is on ${branch} with plans, spec status, acceptance criteria and submodule pointers staged.
  Documentation impact still to apply (from the spec; tick each item in ${specRel} once done):
${docImpactTodo(read(root, specRel))}
  Before committing:
    1. Apply the items above to the living documents and tick them.
    2. pnpm check  (it also names any structural file no architecture document covers)
    3. git commit -m "docs(completion): ${id} ${slug}"
    4. pnpm plan:pr ${id} --completion   for the PR title and body.
  After the completion PR is merged: pnpm plan:cleanup ${id}`);
}

// ── bounded work ────────────────────────────────────────────────────────────

const BOUNDED_RE = /^([a-z]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function boundedBranch(branch) {
  const m = BOUNDED_RE.exec(branch || '');
  if (!m || parsePlanBranch(branch) || branchNameError(branch)) {
    throw new HubError(`"${branch}" is not a bounded-work branch; use <type>/<slug>, e.g. fix/login-redirect (planned work uses pnpm plan:start)`);
  }
  return m[2];
}

function cmdWorkStart(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { 'no-install': { type: 'boolean', default: false }, issue: { type: 'string' } } });
  const [repoName, branch] = positionals;
  if (!repoName || !branch) throw new HubError('usage: pnpm work:start <repo> <type>/<slug> [--issue <n | owner/repo#n>]');
  const cfg = loadConfig(root);
  const repo = repoConfig(cfg, repoName);
  const dirName = `${repo.name}--${boundedBranch(branch)}`;
  const g = values.issue ? github(cfg) : null;
  if (values.issue && !g) throw new HubError('--issue needs GitHub mode (pnpm gh:setup)');
  let issue = null;
  if (g) {
    const ref = parseIssueRef(values.issue, g.hubRepo);
    const data = viewIssue(ref.repo, ref.number);
    issue = { repo: ref.repo, number: ref.number, url: data.url, title: data.title };
    mkdirSync(join(root, '.worktrees'), { recursive: true });
    writeFileSync(join(root, '.worktrees', `${dirName}.issue.md`), issueContext(data, ref.repo));
  }
  const wt = prepareWorktree({ repo, branch, dirName, planId: null, install: !values['no-install'] });
  if (issue) {
    writeFileSync(join(root, '.worktrees', `${dirName}.json`), JSON.stringify({ issue }, null, 2) + '\n');
    if (issue.repo === g.hubRepo) {
      addLabels(issue.repo, issue.number, ['tier:bounded', `repo:${repo.name}`]);
      setStatus(issue.repo, issue.number, STATUS.ongoing);
    }
    comment(issue.repo, issue.number, boundedStartedComment({ repo: repo.name, branch }), `work-started:${repo.name}:${branch}`);
  }
  console.log(`
  Work in the worktree:
    cd ${wt}${issue ? `\n  The issue and its comments, as context:  ${join(root, '.worktrees', `${dirName}.issue.md`)}` : ''}
  Commit with Conventional Commits. In the commit body write labelled paragraphs, which become the PR's sections:
    Cause: (a bug) or Rationale: (any other change), then Fix:, Verification:, and Risk: if there is one.
  For the PR: pnpm work:pr ${repo.name} ${branch}${g ? ' --create' : ''}   (ask your human partner first)
  If behaviour or structure changed, update docs/features/ or docs/codebases/${repo.name}/ in a hub PR.
  After the PR is merged: pnpm work:cleanup ${repo.name} ${branch}`);
}

const FOOTER_KEYS = /^(Plan|Task|Refs|Ruling|Co-Authored-By|Signed-off-by|Fixes|Closes):/i;

// Files a branch changes relative to the default branch, and which of them are tests.
function branchFiles(repo, repoDir, defaultRef, branch) {
  const out = gitTry(repoDir, ['diff', '--name-status', `${defaultRef}...refs/heads/${branch}`]).out;
  const files = out.split('\n').filter(Boolean).map((l) => {
    const parts = l.split('\t');
    return { status: parts[0], path: parts[parts.length - 1] };
  });
  return { files, tests: files.filter((f) => f.status[0] !== 'D' && matchesAny(f.path, repo.tests)).map((f) => f.path) };
}

function cmdWorkPr(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { create: { type: 'boolean', default: false } } });
  const [repoName, branch] = positionals;
  if (!repoName || !branch) throw new HubError('usage: pnpm work:pr <repo> <type>/<slug> [--create]');
  const cfg = loadConfig(root);
  const repo = repoConfig(cfg, repoName);
  const slug = boundedBranch(branch);
  const dirName = `${repo.name}--${slug}`;
  const repoDir = join(root, repo.path);
  const defaultRef = refExists(repoDir, `origin/${repo.defaultBranch}`) ? `origin/${repo.defaultBranch}` : repo.defaultBranch;
  const commits = logMessages(repoDir, ['--no-merges', '--reverse', `${defaultRef}..refs/heads/${branch}`]);
  if (commits.length === 0) throw new HubError(`${branch} has no commits beyond ${defaultRef}`);
  const metaFile = join(root, '.worktrees', `${dirName}.json`);
  const issue = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')).issue : null;
  const type = branch.split('/')[0];
  const title = commits.length === 1 && !commitHeaderError(commits[0].subject) ? commits[0].subject : `${type}: ${slug.replace(/-/g, ' ')}`;
  const sections = explanationSections(commits.map((c) => c.body.split('\n').slice(1).filter((l) => !FOOTER_KEYS.test(l)).join('\n')));
  const refs = [...new Set(commits.flatMap((c) => footerValues(c.body, 'Refs').flatMap((v) => v.split(/[,\s]+/).filter(Boolean))))];
  const { files, tests } = branchFiles(repo, repoDir, defaultRef, branch);
  const fixesRef = issue ? `${issue.repo === repo.github ? '' : issue.repo}#${issue.number}` : null;
  const body = fixPrBody({ issue: issue && { ref: `${issue.repo}#${issue.number}`, title: issue.title }, commits, files, tests, sections, refs, fixesRef });
  const summary = [
    sections.cause && `**Root cause:** ${sections.cause}`,
    sections.rationale && `**Rationale:** ${sections.rationale}`,
    (sections.fix || sections.other) && `**Fix:** ${sections.fix || sections.other}`,
    sections.verification && `**Verified:** ${sections.verification}`,
  ].filter(Boolean).join('\n\n') || commits.map((c) => `- ${c.subject}`).join('\n');
  printPr(title, body);
  if (!values.create) return;
  const g = github(cfg);
  if (!g) throw new HubError('--create needs GitHub mode (pnpm gh:setup)');
  const wt = join(root, '.worktrees', dirName);
  git(existsSync(wt) ? wt : repoDir, ['push', '--quiet', '-u', 'origin', branch]);
  const pr = createPr(requireRepoSlug(repo), { head: branch, base: repo.defaultBranch, title, body });
  log(`GitHub: ${pr.reused ? 'reusing the open PR' : 'opened'} ${pr.url}`);
  if (issue) {
    comment(issue.repo, issue.number, boundedReadyComment({ repo: repo.name, summary, prUrl: pr.url }), `fix-ready:${repo.name}:${branch}`);
    if (issue.repo === g.hubRepo) {
      setStatus(issue.repo, issue.number, STATUS.review);
      if (commits.some((c) => isBreaking(c.subject))) addLabels(issue.repo, issue.number, ['breaking-change']);
    }
    log(`GitHub: explained the fix on ${issue.repo}#${issue.number}`);
  }
}

function cmdWorkCleanup(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [repoName, branch] = positionals;
  if (!repoName || !branch) throw new HubError('usage: pnpm work:cleanup <repo> <type>/<slug>');
  const repo = repoConfig(loadConfig(root), repoName);
  const dirName = `${repo.name}--${boundedBranch(branch)}`;
  removeWorktree(repo, join(root, '.worktrees', dirName), branch);
  for (const f of [`${dirName}.json`, `${dirName}.issue.md`]) rmSync(join(root, '.worktrees', f), { force: true });
}

// Remove a worktree only when git agrees it is clean, then delete its local branch.
function removeWorktree(repo, wt, branch) {
  const repoDir = join(root, repo.path);
  if (existsSync(wt)) {
    const r = gitTry(repoDir, ['worktree', 'remove', wt]);
    if (!r.ok) throw new HubError(`${wt} was kept: ${r.err}\n  Commit or discard its changes, then rerun.`);
    log(`removed ${wt}`);
  }
  if (refExists(repoDir, `refs/heads/${branch}`)) {
    git(repoDir, ['branch', '-D', branch]);
    log(`deleted local branch ${branch} in ${repo.path} (the squash commit on ${repo.defaultBranch} holds the work)`);
  }
}

// ── pull requests ───────────────────────────────────────────────────────────

function hubFile(rel, cfg) {
  if (existsSync(join(root, rel))) return read(root, rel);
  for (const ref of [`origin/${cfg.defaultBranch}`, cfg.defaultBranch]) {
    const t = showFile(root, ref, rel);
    if (t) return t;
  }
  throw new HubError(`${rel} not found in the working tree or on ${cfg.defaultBranch}`);
}

function workFiles(id, cfg) {
  const work = loadWork(root).get(id);
  const fromBase = (dir) => gitTry(root, ['ls-tree', '--name-only', `origin/${cfg.defaultBranch}:${dir}`]).out.split('\n');
  const planNames = new Set([...(work?.plans || []).map((p) => p.file.split('/').pop()), ...fromBase(DIRS.plans)]);
  const plans = [...planNames].map((n) => ({ n, p: parsePlanFilename(n) })).filter((x) => x.p && x.p.id === id)
    .map(({ n, p }) => ({ ...p, rel: `${DIRS.plans}/${n}` }));
  if (plans.length === 0) throw new HubError(`no plans with ID ${id}`);
  return { slug: plans[0].slug, plans, specRel: specPath(id, plans[0].slug) };
}

function goalOf(specText) {
  const g = section(specText, 'Goal');
  return g ? g.text.trim().split('\n\n')[0] : headings(specText).find((h) => h.level === 1)?.title || '';
}

function printPr(title, body) {
  const err = commitHeaderError(title);
  if (err) throw new HubError(`generated title is invalid: ${err}`);
  console.log(`TITLE\n${title}\n\nBODY\n${body.trim()}\n`);
}

// The epic a spec belongs to, from its "- Epic: [..](../../epics/<slug>/README.md)" link.
function epicOf(specText) {
  const l = section(specText, 'Links');
  const m = l && /- Epic:.*?\]\([^)]*epics\/([a-z0-9-]+)\/README\.md\)/.exec(l.text);
  return m ? m[1] : null;
}

const isBreaking = (header) => /^[a-z]+(\([^)]*\))?!:/.test(header);

function requireRepoSlug(repo) {
  if (!repo.github) throw new HubError(`set "github": "owner/name" for ${repo.name} in hub.config.json`);
  return repo.github;
}

function cmdPr(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: {
      repo: { type: 'string' }, spec: { type: 'boolean', default: false }, completion: { type: 'boolean', default: false },
      scope: { type: 'string' }, create: { type: 'boolean', default: false },
    },
  });
  const [id] = positionals;
  requireId(id);
  if ([values.repo, values.spec, values.completion].filter(Boolean).length !== 1) {
    throw new HubError('usage: pnpm plan:pr <id> --spec | --repo <name> [--scope <scope>] | --completion   [--create]');
  }
  const cfg = loadConfig(root);
  const g = values.create ? github(cfg) : cfg.github?.enabled ? cfg.github : null;
  if (values.create && !g) throw new HubError('--create needs GitHub mode (pnpm gh:setup)');
  const issueNo = g ? Number(id) : null;
  const { slug, plans, specRel } = workFiles(id, cfg);
  const specText = hubFile(specRel, cfg);
  const acSection = section(specText, 'Acceptance criteria');
  const { added: criteria, removed: retired } = acSection ? splitCriteria(acSection.text) : { added: [], removed: [] };
  const retiredText = retired.length ? `\n\n**Behaviour it retires**\n\n${retired.map((b) => b.lines.join('\n')).join('\n')}` : '';
  const criteriaText = (criteria.length ? criteria.map((b) => b.lines.join('\n')).join('\n') : '- No new or changed behaviour.') + retiredText;
  const goal = goalOf(specText);

  // Hub PRs (spec and completion) are opened from the current hub branch.
  const hubPr = (expectedBranch, title, body, afterCreate) => {
    printPr(title, body);
    if (!values.create) return;
    const current = git(root, ['branch', '--show-current']);
    if (current !== expectedBranch) throw new HubError(`switch the hub to ${expectedBranch} first (it is on ${current})`);
    git(root, ['push', '--quiet', '-u', 'origin', expectedBranch]);
    const epic = epicOf(specText);
    if (epic) ensureLabels(g.hubRepo, [epicLabel(epic)]);
    const pr = createPr(g.hubRepo, { head: expectedBranch, base: cfg.defaultBranch, title, body, labels: epic ? [`epic:${epic}`] : [] });
    log(`GitHub: ${pr.reused ? 'reusing the open PR' : 'opened'} ${pr.url}`);
    afterCreate(pr);
  };

  if (values.spec) {
    hubPr(`docs/${id}-${slug}-spec`, `docs(spec): ${id} ${slug}`, `## What this work is for

${goal}

## Behaviour it will deliver

${criteriaText}

## Plans

${plans.map((p) => `- \`${p.repo}\`: ${parsePlan(hubFile(p.rel, cfg)).tasks.length} tasks in \`${p.rel}\``).join('\n')}

Approving this PR approves the design in \`${specRel}\` for implementation.${g ? `\n\nTracking issue: #${issueNo}` : ''}`, (pr) => {
      comment(g.hubRepo, issueNo, specReadyComment({ goal, criteria: criteria.length ? criteriaText : '', prUrl: pr.url }), 'spec-ready');
      setStatus(g.hubRepo, issueNo, STATUS.review);
    });
    return;
  }

  if (values.completion) {
    const shipped = [];
    const rulings = [];
    const deferred = [];
    const lines = plans.map((p) => {
      const plan = parsePlan(hubFile(p.rel, cfg));
      if (!plan.completion) throw new HubError(`${p.rel} has no Completion section; run pnpm plan:complete ${id} first`);
      const merged = plan.merged.map((m) => `\`${m.path}@${m.sha}\``).join(', ');
      shipped.push(`\`${p.repo}\`: merged as ${merged}`);
      const r = section(plan.completion.text, 'Rulings');
      if (r) rulings.push(...r.text.split('\n').filter((l) => l.startsWith('- ') && !/^- None recorded/.test(l)).map((l) => `\`${p.repo}\`: ${l.slice(2)}`));
      for (const t of plan.tasks.filter((t) => plan.deferred.has(t.number))) deferred.push(`\`${p.repo}\` task ${t.number}: ${t.title}`);
      return `- \`${p.repo}\`: merged as ${merged}${plan.deferred.size ? `; deferred: ${[...plan.deferred].map((n) => `Task ${n}`).join(', ')}` : ''}`;
    });
    const manual = section(specText, 'Manual steps');
    const manualSteps = manual && manual.text.trim() ? manual.text.trim() : '';
    hubPr(`docs/${id}-${slug}-completion`, `docs(completion): ${id} ${slug}`, `## Shipped

${lines.join('\n')}

## Behaviour now on main

${criteriaText}
${manualSteps ? `\n## Manual steps still needed\n\n${manualSteps}\n` : ''}
${(() => { const i = section(specText, 'Documentation impact'); return i && i.text.trim() ? `## Documentation updated\n\n${i.text.trim()}\n\n` : ''; })()}Plans, rulings and merge commits are recorded in each plan's \`## Completion\` section.${g ? `\n\nCloses #${issueNo}` : ''}`, (pr) => {
      comment(g.hubRepo, issueNo, completionComment({ shipped, criteria: criteria.length ? criteriaText : '', rulings, deferred, manualSteps, prUrl: pr.url }), 'shipped');
      setStatus(g.hubRepo, issueNo, manualSteps || deferred.length ? STATUS.manual : STATUS.review);
    });
    return;
  }

  const target = plans.find((p) => p.repo === values.repo);
  if (!target) throw new HubError(`no plan ${id} for repo "${values.repo}"`);
  const repo = repoConfig(cfg, target.repo);
  const planText = hubFile(target.rel, cfg);
  const plan = parsePlan(planText);
  const b = parsePlanBranch(plan.branch || '');
  if (!b) throw new HubError(`${target.rel} has no valid **Branch:** line`);
  const repoDir = join(root, repo.path);
  const { done, refs, rulings } = taskProgress(repoDir, repo, plan.branch, id);
  const planGoal = (/^\*\*Goal:\*\*\s*(.+)$/m.exec(planText) || [])[1] || goal;
  const covered = criteria.filter((c) => refs.has(c.id) || planText.includes(c.id));
  const doneList = [...done].filter((n) => plan.tasks.some((t) => t.number === n)).sort((x, y) => x - y);
  const taskList = plan.tasks.map((t) => `- [${done.has(t.number) ? 'x' : ' '}] Task ${t.number}: ${t.title}`).join('\n');
  const title = `${b.type}${values.scope ? `(${values.scope})` : ''}: ${slug.replace(/-/g, ' ')}`;
  const defaultRefPr = refExists(repoDir, `origin/${repo.defaultBranch}`) ? `origin/${repo.defaultBranch}` : repo.defaultBranch;
  const { files, tests } = branchFiles(repo, repoDir, defaultRefPr, plan.branch);
  const focus = section(planText, 'Review Focus');
  const body = featurePrBody({
    goal: planGoal,
    specRel,
    trackingRef: g ? `${g.hubRepo}#${issueNo}` : null,
    tasks: taskList,
    files,
    tests,
    criteria: covered.length ? covered.map((c) => c.lines.join('\n')).join('\n') : '- None in this repository.',
    rulings,
    reviewFocus: focus && focus.text.trim(),
    footers: `Plan: ${id}\nTask: ${doneList.join(', ') || 'none yet'}${rulings.map((r) => `\nRuling: ${r}`).join('')}`,
  });
  printPr(title, body);
  if (!values.create) return;
  const wt = join(root, '.worktrees', worktreeDirName(repo.name, id, slug));
  git(existsSync(wt) ? wt : repoDir, ['push', '--quiet', '-u', 'origin', plan.branch]);
  const epic = epicOf(specText);
  if (epic) ensureLabels(requireRepoSlug(repo), [epicLabel(epic)]);
  const pr = createPr(requireRepoSlug(repo), { head: plan.branch, base: repo.defaultBranch, title, body, labels: epic ? [`epic:${epic}`] : [] });
  log(`GitHub: ${pr.reused ? 'reusing the open PR' : 'opened'} ${pr.url}`);
  comment(g.hubRepo, issueNo, codeReadyComment({ repo: repo.name, goal: planGoal, prUrl: pr.url, tasks: taskList, rulings }), `code-ready:${repo.name}`);
  // One issue tracks every repository: it is pending review only once each repository's code is
  // in review (an open PR) or already merged; until then it stays ongoing.
  const waiting = plans.filter((p) => p.repo !== repo.name).filter((p) => {
    const other = repoConfig(cfg, p.repo);
    const otherPlan = parsePlan(hubFile(p.rel, cfg));
    const merged = taskProgress(join(root, other.path), other, otherPlan.branch, id).merged.length > 0;
    return !merged && !openPrFor(requireRepoSlug(other), otherPlan.branch);
  });
  if (waiting.length === 0) setStatus(g.hubRepo, issueNo, STATUS.review);
  else log(`GitHub: issue stays ${STATUS.ongoing} until ${waiting.map((p) => p.repo).join(', ')} has a PR`);
  const branchCommits = logMessages(repoDir, ['--no-merges', `${refExists(repoDir, `origin/${repo.defaultBranch}`) ? `origin/${repo.defaultBranch}` : repo.defaultBranch}..refs/heads/${plan.branch}`]);
  if (branchCommits.some((c) => isBreaking(c.subject))) addLabels(g.hubRepo, issueNo, ['breaking-change']);
}

// ── cleanup and revert ──────────────────────────────────────────────────────

function cmdCleanup(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [id] = positionals;
  requireId(id);
  const cfg = loadConfig(root);
  const hubBase = freshBase(root, cfg.defaultBranch);
  const plans = gitTry(root, ['ls-tree', '--name-only', `${hubBase}:${DIRS.plans}`]).out.split('\n')
    .map((n) => ({ n, p: parsePlanFilename(n) })).filter((x) => x.p && x.p.id === id);
  if (plans.length === 0) throw new HubError(`no plans with ID ${id} on ${hubBase}`);
  for (const { n, p } of plans) {
    const plan = parsePlan(showFile(root, hubBase, `${DIRS.plans}/${n}`));
    if (!plan.completion) throw new HubError(`${n} is not complete on ${hubBase}; merge the completion PR before cleaning up`);
  }
  for (const { n, p } of plans) {
    const plan = parsePlan(showFile(root, hubBase, `${DIRS.plans}/${n}`));
    removeWorktree(repoConfig(cfg, p.repo), join(root, '.worktrees', worktreeDirName(p.repo, id, p.slug)), plan.branch);
  }
}

function cmdRevert(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [id] = positionals;
  requireId(id);
  const cfg = loadConfig(root);
  const hubBase = freshBase(root, cfg.defaultBranch);
  const plans = gitTry(root, ['ls-tree', '--name-only', `${hubBase}:${DIRS.plans}`]).out.split('\n')
    .map((n) => (parsePlanFilename(n) ? { ...parsePlanFilename(n), rel: `${DIRS.plans}/${n}` } : null)).filter((p) => p && p.id === id);
  if (plans.length === 0) throw new HubError(`no plans with ID ${id} on ${hubBase}`);
  const slug = plans[0].slug;
  const out = [`# Revert work ${id} (${slug}). Nothing below has been run; review, then run it step by step.`];
  for (const p of plans) {
    const repo = repoConfig(cfg, p.repo);
    const repoDir = join(root, repo.path);
    const defaultRef = freshBase(repoDir, repo.defaultBranch);
    // Commits found by their footer, plus those a completion recorded (a squash may have lost its footer).
    const recorded = parsePlan(hubFile(p.rel, cfg)).merged.filter((m) => m.path === repo.path)
      .map((m) => gitTry(repoDir, ['rev-parse', '--verify', `${m.sha}^{commit}`]).out).filter(Boolean);
    const shas = [...new Set([...logMessages(repoDir, ['--grep', `^Plan: ${id}$`, defaultRef]).map((m) => m.sha), ...recorded])];
    const merged = shas.length ? logMessages(repoDir, ['--no-walk', ...shas]) : [];
    if (merged.length === 0) {
      out.push('', `# ${repo.path}: no commit with "Plan: ${id}" on ${defaultRef}; nothing to revert`);
      continue;
    }
    out.push('', `# ${repo.path}: ${merged.map((m) => `${m.sha.slice(0, 12)} ${m.subject}`).join('; ')}`,
      `pnpm work:start ${repo.name} revert/${slug}`,
      `git -C .worktrees/${repo.name}--${slug} revert --no-edit ${merged.map((m) => m.sha).join(' ')}`,
      `git -C .worktrees/${repo.name}--${slug} push -u origin revert/${slug}`,
      `# open a PR in ${repo.path}, squash merge it, then: pnpm work:cleanup ${repo.name} revert/${slug}`);
  }
  const completion = logMessages(root, ['--grep', `^docs(completion): ${id} `, hubBase]);
  out.push('', '# hub: restore the documents and submodule pointers to before the work');
  if (completion.length) {
    out.push(`git switch -c docs/${id}-${slug}-revert ${hubBase}`,
      `git revert --no-edit ${completion.map((c) => c.sha).join(' ')}`,
      `# set status: abandoned in ${specPath(id, slug)}, run pnpm check, commit, open the hub PR`);
  } else out.push(`# no "docs(completion): ${id}" commit on ${hubBase}; only the spec may need status: abandoned`);
  console.log(out.join('\n'));
}

// ── abandon ─────────────────────────────────────────────────────────────────

function cmdAbandon(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { reason: { type: 'string' } } });
  const [id] = positionals;
  requireId(id);
  if (!values.reason || !values.reason.trim()) throw new HubError('usage: pnpm plan:abandon <id> --reason "<why the work stops>"');
  const reason = values.reason.trim();
  const cfg = loadConfig(root);
  const g = github(cfg);
  requireCleanHub();
  const hubBase = freshBase(root, cfg.defaultBranch);

  const onBase = (dir) => gitTry(root, ['ls-tree', '--name-only', `${hubBase}:${dir}`]).out.split('\n');
  const plans = onBase(DIRS.plans).map((n) => (parsePlanFilename(n) ? { ...parsePlanFilename(n), rel: `${DIRS.plans}/${n}` } : null)).filter((p) => p && p.id === id);
  const specName = onBase(DIRS.specs).find((n) => n.startsWith(`${id}-`) && n.endsWith('-design.md'));
  const branchSlug = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])
    .split('\n').map((b) => new RegExp(`(?:^|/)docs/${id}-([a-z0-9-]+)-spec$`).exec(b)).find(Boolean)?.[1];
  const slug = plans[0]?.slug || (specName && specName.slice(7, -'-design.md'.length)) || branchSlug;
  if (!slug) throw new HubError(`no work ${id} on ${hubBase} or in local branches`);

  // Shipped code is not abandoned, it is reverted.
  for (const p of plans) {
    const repo = repoConfig(cfg, p.repo);
    const plan = parsePlan(showFile(root, hubBase, p.rel));
    if (plan.completion || taskProgress(join(root, repo.path), repo, plan.branch, id).merged.length) {
      throw new HubError(`work ${id} is already merged in ${repo.path}; undo it with pnpm plan:revert ${id}, then abandon`);
    }
  }

  const closed = [];
  for (const p of plans) {
    const repo = repoConfig(cfg, p.repo);
    const plan = parsePlan(showFile(root, hubBase, p.rel));
    if (g && repo.github) {
      const pr = openPrFor(repo.github, plan.branch);
      if (pr) {
        closePr(repo.github, pr.number, `Closed without merging: work ${id} was abandoned. ${reason}`);
        closed.push(pr.url);
      }
    }
    try {
      removeWorktree(repo, join(root, '.worktrees', worktreeDirName(repo.name, id, slug)), plan.branch);
    } catch (e) {
      console.warn(`[plan] warning: ${e.message}`);
    }
  }
  if (g) {
    const specPr = openPrFor(g.hubRepo, `docs/${id}-${slug}-spec`);
    if (specPr) {
      closePr(g.hubRepo, specPr.number, `Closed without merging: work ${id} was abandoned. ${reason}`);
      closed.push(specPr.url);
    }
  }

  let next;
  if (specName) {
    const branch = `docs/${id}-${slug}-abandon`;
    git(root, ['switch', '--quiet', '--no-track', '-c', branch, hubBase]);
    syncSubmodules();
    const spec = specPath(id, slug);
    writeFileSync(join(root, spec), setFrontmatterValue(read(root, spec), 'status', 'abandoned'));
    git(root, ['add', spec]);
    next = `The hub is on ${branch} with the spec set to abandoned. Commit and open its PR:
    git commit -m "docs(spec): abandon ${id} ${slug}" -m "${reason.replace(/"/g, '\\"')}"`;
  } else {
    next = `The design never reached ${cfg.defaultBranch}, so there is nothing to record in the hub.
  Delete the draft when you no longer need it:  git branch -D docs/${id}-${slug}-spec`;
  }

  if (g) {
    const n = Number(id);
    comment(g.hubRepo, n, abandonedComment({ id, reason, closed, recorded: !!specName }), 'abandoned');
    removeLabels(g.hubRepo, n, 'status:');
    closeIssue(g.hubRepo, n, 'not planned');
    log(`GitHub: closed ${g.hubRepo}#${n} as not planned${closed.length ? ` and ${closed.length} PR(s)` : ''}`);
  }
  console.log(`
  ${next}
  Remote branches, if any were pushed, stay until you delete them on GitHub.`);
}

// ── epics ───────────────────────────────────────────────────────────────────

function cmdEpicNew(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { issue: { type: 'string' }, title: { type: 'string' }, prd: { type: 'string' } } });
  const [slug] = positionals;
  if (!slug || !SLUG_RE.test(slug)) throw new HubError('usage: pnpm epic:new <slug> [--prd <file>] [--issue <n>] [--title "<issue title>"]');
  const cfg = loadConfig(root);
  const g = github(cfg);
  if (values.issue && !g) throw new HubError('--issue needs GitHub mode (pnpm gh:setup)');
  const dir = `${DIRS.epics}/${slug}`;
  if (values.prd && !existsSync(values.prd)) throw new HubError(`no PRD file ${values.prd}`);
  requireCleanHub();
  const base = freshBase(root, cfg.defaultBranch);
  if (existsSync(join(root, dir)) || gitTry(root, ['cat-file', '-e', `${base}:${dir}/README.md`]).ok) throw new HubError(`epic ${slug} already exists`);

  let number = null;
  if (g) {
    ensureLabels(g.hubRepo, [epicLabel(slug)]);
    if (values.issue) {
      const ref = parseIssueRef(values.issue, g.hubRepo);
      if (ref.repo !== g.hubRepo) throw new HubError(`epic issues live in the hub repository ${g.hubRepo}`);
      number = ref.number;
      viewIssue(g.hubRepo, number);
    } else {
      number = createIssue(g.hubRepo, values.title || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), epicIssueBody({ slug })).number;
    }
    addLabels(g.hubRepo, number, ['tier:epic', `epic:${slug}`]);
    setStatus(g.hubRepo, number, STATUS.ongoing);
    comment(g.hubRepo, number, epicStartedComment({ slug }), 'epic-started');
    log(`GitHub: issue ${g.hubRepo}#${number} tracks epic ${slug}`);
  }

  const branch = `docs/epic-${slug}`;
  git(root, ['switch', '--quiet', '--no-track', '-c', branch, base]);
  syncSubmodules();
  mkdirSync(join(root, dir), { recursive: true });
  if (values.prd) {
    const raw = readFileSync(values.prd, 'utf8');
    const fm = splitFrontmatter(raw);
    const body = fm.has ? raw.split('\n').slice(fm.bodyStartLine - 1).join('\n') : raw;
    writeFileSync(join(root, dir, 'prd.md'), `---\ntype: prd\n---\n${body.replace(/^\n+/, '')}`);
    log(`stored the PRD as ${dir}/prd.md`);
  }
  log(`switched the hub to ${branch}`);
  console.log(`
  Epic design (the epic-design skill writes it):  ${dir}/README.md${number ? `   (frontmatter: issue: ${number})` : ''}
  Product requirements:                            ${dir}/prd.md${values.prd ? '   (stored; requirements still need **REQ-n** IDs)' : ''}

  Next: ask your agent to run the epic-design skill on the PRD and your technical design.
  When pnpm check passes: git commit -m "docs(epic): ${slug}"   then   pnpm epic:pr ${slug}${g ? ' --create' : ''}`);
}

function cmdEpicPr(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { create: { type: 'boolean', default: false } } });
  const [slug] = positionals;
  if (!slug || !SLUG_RE.test(slug)) throw new HubError('usage: pnpm epic:pr <slug> [--create]');
  const cfg = loadConfig(root);
  const rel = `${DIRS.epics}/${slug}/README.md`;
  const text = hubFile(rel, cfg);
  const fm = splitFrontmatter(text).data;
  const outcome = section(text, 'Outcome');
  const map = section(text, 'Requirement map');
  const phases = section(text, 'Phases');
  const done = fm.status === 'done';
  const title = done ? `docs(epic): complete ${slug}` : `docs(epic): ${slug}`;
  const issueLine = fm.issue && cfg.github?.enabled ? `\n\n${done ? 'Closes' : 'Refs'} #${fm.issue}` : '';
  const body = `## Outcome

${outcome ? outcome.text.trim() : '(no Outcome section)'}

## Requirement map

${map ? map.text.trim() : '(no Requirement map section)'}

## Phases

${phases ? phases.text.trim() : '(no Phases section)'}

${done ? 'Every phase is complete or abandoned; this closes the epic.' : 'Approving this PR agrees the direction and the phases. Each phase still gets its own design spec and review when it starts (`pnpm plan:new … --epic ' + slug + '`).'}${issueLine}`;
  printPr(title, body);
  if (!values.create) return;
  const g = github(cfg);
  if (!g) throw new HubError('--create needs GitHub mode (pnpm gh:setup)');
  const current = git(root, ['branch', '--show-current']);
  if (!current.startsWith(`docs/epic-${slug}`)) throw new HubError(`switch the hub to the epic's branch (docs/epic-${slug}…) first`);
  git(root, ['push', '--quiet', '-u', 'origin', current]);
  ensureLabels(g.hubRepo, [epicLabel(slug)]);
  const pr = createPr(g.hubRepo, { head: current, base: cfg.defaultBranch, title, body, labels: [`epic:${slug}`] });
  log(`GitHub: ${pr.reused ? 'reusing the open PR' : 'opened'} ${pr.url}`);
  if (fm.issue && !done) {
    comment(g.hubRepo, Number(fm.issue), epicReadyComment({ outcome: outcome ? outcome.text.trim() : '', phases: phases ? phases.text.trim() : '', prUrl: pr.url }), 'epic-ready');
    setStatus(g.hubRepo, Number(fm.issue), STATUS.review);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  new: cmdNew, start: cmdStart, status: cmdStatus, complete: cmdComplete, pr: cmdPr, cleanup: cmdCleanup, revert: cmdRevert, abandon: cmdAbandon,
  'work-start': cmdWorkStart, 'work-pr': cmdWorkPr, 'work-cleanup': cmdWorkCleanup, 'epic-new': cmdEpicNew, 'epic-pr': cmdEpicPr,
};
try {
  if (!commands[cmd]) throw new HubError(`unknown command "${cmd}"; see the Commands table in docs/WORKFLOW.md`);
  commands[cmd](rest);
} catch (e) {
  console.error(`[plan] ${e.message}`);
  process.exit(1);
}
