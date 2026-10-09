// End-to-end: a scratch hub with two product repositories (one using lefthook when it is on PATH,
// one with plain hooks) goes through repo:add → plan:new → spec PR → plan:start → task commits →
// squash merge → plan:complete → completion PR, then every check rule is broken once on purpose.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makePristineHub } from './fixture.mjs';

const base = mkdtempSync(join(tmpdir(), 'hub-e2e-'));
const hub = join(base, 'hub');
writeFileSync(join(base, 'gitconfig'), `[user]
  name = Hub Test
  email = hub-test@example.com
[init]
  defaultBranch = main
[protocol "file"]
  allow = always
[advice]
  detachedHead = false
[commit]
  gpgsign = false
`);
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: join(base, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', HUB_SKIP_GRAPHIFY: '1' };
const LEFTHOOK = spawnSync('lefthook', ['version'], { env: ENV }).status === 0;
after(() => {
  if (process.env.HUB_KEEP_E2E === '1') console.log(`e2e hub kept at ${hub}`);
  else rmSync(base, { recursive: true, force: true });
});

function run(cwd, cmd, args, { ok = true, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: ENV, encoding: 'utf8', input });
  const out = `${r.stdout}${r.stderr}`;
  if (ok && r.status !== 0) assert.fail(`${cmd} ${args.join(' ')} (in ${cwd}) exited ${r.status}:\n${out}`);
  if (!ok && r.status === 0) assert.fail(`${cmd} ${args.join(' ')} (in ${cwd}) should have failed:\n${out}`);
  return out;
}
const git = (cwd, ...args) => run(cwd, 'git', args);
const gitFails = (cwd, ...args) => run(cwd, 'git', args, { ok: false });
const tool = (script, ...args) => run(hub, 'node', [`tools/${script}`, ...args]);
const toolFails = (script, ...args) => run(hub, 'node', [`tools/${script}`, ...args], { ok: false });
const check = () => run(hub, 'node', ['tools/docs-check.mjs'], { ok: false });
const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

function productRepo(name, files) {
  const src = join(base, `${name}-src`);
  mkdirSync(src);
  git(src, 'init', '--quiet');
  for (const [f, t] of Object.entries(files)) write(join(src, f), t);
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'chore: initial');
  const bare = join(base, `${name}.git`);
  git(base, 'clone', '--quiet', '--bare', src, bare);
  return bare;
}

// Simulates the hosting service's "squash and merge" with its default body.
function squashMerge(bare, branch, title, prBody) {
  const dir = join(base, `merge-${basename(bare)}-${Date.now()}`);
  git(base, 'clone', '--quiet', bare, dir);
  const bodies = prBody ?? git(dir, 'log', '--reverse', '--format=* %B', `origin/main..origin/${branch}`);
  git(dir, 'merge', '--quiet', '--squash', `origin/${branch}`);
  git(dir, 'commit', '--quiet', '-m', `${title}\n\n${bodies}`);
  git(dir, 'push', '--quiet', 'origin', 'main');
  return git(dir, 'rev-parse', 'HEAD').trim();
}

const PLAN = (repo, branch, tasks) => `# Checkout payments (${repo}) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Pay orders by card.

**Spec:** [000001 design](../specs/000001-checkout-payments-design.md)

**Repo:** \`repos/${repo}\`

**Branch:** \`${branch}\`

## Execution rules

- Finish with "Push and create a Pull Request".

---

${tasks.map((t, i) => `### Task ${i + 1}: ${t}\n\n- [ ] **Step 1: Write the failing test**\n- [ ] **Step 2: Implement**\n- [ ] **Step 3: Commit**\n`).join('\n')}`;

let apiBare;
let webBare;
const wtApi = () => join(hub, '.worktrees', 'api--000001-checkout-payments');
const wtWeb = () => join(hub, '.worktrees', 'web--000001-checkout-payments');

test('scratch hub and product repositories', () => {
  apiBare = productRepo('api', {
    'src/billing/billing.module.ts': 'export class BillingModule {}\n',
    'src/billing/billing.service.ts': '// WHY: issued invoices are never edited (ADR-0004)\nexport class BillingService {\n  issue(amount: number) {\n    return { amount };\n  }\n}\n',
    'src/billing/billing.service.spec.ts': "it('BILL-ISSUE-1: issues an invoice', () => {});\n",
  });
  webBare = productRepo('web', {
    'app/(shop)/layout.tsx': 'export default function ShopLayout() {\n  return null;\n}\n',
    ...(LEFTHOOK ? { 'lefthook.yml': `commit-msg:\n  commands:\n    team-check:\n      run: echo team >> "${join(base, 'team-hook-ran')}"\n` } : {}),
  });
  makePristineHub(hub);
  git(hub, 'init', '--quiet');
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'chore: initial hub');
  git(base, 'clone', '--quiet', '--bare', hub, join(base, 'hub.git'));
  git(hub, 'remote', 'add', 'origin', join(base, 'hub.git'));
  git(hub, 'fetch', '--quiet', 'origin');
  git(hub, 'branch', '--quiet', '--set-upstream-to=origin/main');
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/, 'a fresh hub passes its own checks');
});

test('repo:add onboards repositories; check demands their architecture maps', () => {
  tool('repo.mjs', 'add', 'api', apiBare, '--preset', 'nest');
  const webOut = tool('repo.mjs', 'add', 'web', webBare, '--preset', 'next');
  if (LEFTHOOK) {
    assert.match(webOut, /lefthook/);
    assert.ok(!existsSync(join(hub, '.git/hooks/prepare-commit-msg')), 'lefthook must not install into the hub');
  }
  const out = check();
  assert.match(out, /docs\/codebases\/api\/ARCHITECTURE\.md.*missing/);
  assert.match(out, /docs\/codebases\/web\/ARCHITECTURE\.md.*missing/);

  write(join(hub, 'docs/codebases/api/ARCHITECTURE.md'), `---\ntype: architecture\n---\n# api: architecture\n\n- \`repos/api/src/billing/billing.module.ts\`: invoices, issued by \`repos/api/src/billing/billing.service.ts::BillingService\`.\n`);
  write(join(hub, 'docs/codebases/web/ARCHITECTURE.md'), `---\ntype: architecture\n---\n# web: architecture\n\n- \`repos/web/app/(shop)/layout.tsx\`: the shop shell.\n`);
  const arch = join(hub, 'docs/ARCHITECTURE.md');
  writeFileSync(arch, readFileSync(arch, 'utf8')
    .replace('|---|---|---|\n', '|---|---|---|\n| api | [map](codebases/api/ARCHITECTURE.md) | HTTP API |\n| web | [map](codebases/web/ARCHITECTURE.md) | Web app |\n')
    + '4. [ADR-0004: Issued invoices are immutable](adr/0004-immutable-invoices.md)\n');
  write(join(hub, 'docs/adr/0004-immutable-invoices.md'), '---\ntype: adr\nstatus: accepted\n---\n# ADR-0004: Issued invoices are immutable\n\nCorrections are credit notes.\n');
  write(join(hub, 'docs/features/billing.md'), '---\ntype: feature\n---\n# Billing\n\n- **BILL-ISSUE-1** When an order is paid, the system shall issue an invoice.\n');
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
});

test('hub:setup installs hub hooks; hub commits must be conventional and pass check', () => {
  tool('setup.mjs');
  assert.equal(git(hub, 'config', '--get', 'submodule.recurse').trim(), 'true');
  assert.match(tool('doctor.mjs'), /\[doctor\] ok/);
  git(hub, 'add', '-A');
  gitFails(hub, 'commit', '--quiet', '-m', 'added repos');
  git(hub, 'commit', '--quiet', '-m', 'chore(repos): add api and web');
  git(hub, 'push', '--quiet', 'origin', 'main');
});

test('check reads untracked documents, but not the ones git ignores', () => {
  write(join(hub, 'docs/scratch/notes.md'), '# my notes\n');
  assert.match(check(), /docs\/scratch\/notes\.md:1 +\[location\]/);
  writeFileSync(join(hub, '.git/info/exclude'), `${readFileSync(join(hub, '.git/info/exclude'), 'utf8')}docs/scratch/\n`);
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
});

test('plan:new allocates 000001 and the spec branch; hand-ticked boxes are rejected', () => {
  const out = tool('plan.mjs', 'new', 'checkout-payments', '--repos', 'api,web');
  assert.match(out, /000001/);
  assert.equal(git(hub, 'branch', '--show-current').trim(), 'docs/000001-checkout-payments-spec');
  write(join(hub, 'docs/superpowers/specs/000001-checkout-payments-design.md'), `---\ntype: design\nstatus: approved\n---\n# Checkout payments: design\n\n## Context\n\nBilling exists in \`repos/api/src/billing/billing.service.ts\`.\n\n## Acceptance criteria\n\n- **CHECKOUT-PAY-1** When a customer confirms an order, the system shall charge the card.\n- **CHECKOUT-PAY-2** If the card is declined, then the system shall show the decline reason.\n\n## Documentation impact\n\n- [ ] \`docs/codebases/api/ARCHITECTURE.md\`: document the payments module\n\n## Links\n\n- Feature: \`docs/features/checkout-payments.md\` (new)\n`);
  write(join(hub, 'docs/superpowers/plans/000001-checkout-payments--api.md'), PLAN('api', 'feat/000001-checkout-payments', ['Charge the card', 'Payments module']));
  write(join(hub, 'docs/superpowers/plans/000001-checkout-payments--web.md'), PLAN('web', 'feat/000001-checkout-payments', ['Decline message']));
  const apiPlan = join(hub, 'docs/superpowers/plans/000001-checkout-payments--api.md');
  const original = readFileSync(apiPlan, 'utf8');
  writeFileSync(apiPlan, original.replace('- [ ] **Step', '- [x] **Step'));
  assert.match(check(), /\[progress\]/);
  writeFileSync(apiPlan, original);
  toolFails('plan.mjs', 'start', '000001', '--repo', 'api');
  const pr = tool('plan.mjs', 'pr', '000001', '--spec');
  assert.match(pr, /TITLE\ndocs\(spec\): 000001 checkout-payments/);
  assert.match(pr, /\*\*CHECKOUT-PAY-2\*\*/);
  assert.match(pr, /`api`: 2 tasks/);
});

test('spec PR merges into main', () => {
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'docs(spec): 000001 checkout-payments');
  git(hub, 'switch', '--quiet', 'main');
  git(hub, 'merge', '--quiet', '--squash', 'docs/000001-checkout-payments-spec');
  git(hub, 'commit', '--quiet', '-m', 'docs(spec): 000001 checkout-payments (#1)');
  git(hub, 'push', '--quiet', 'origin', 'main');
});

test('plan:start creates the api worktree from a fresh main and self-tests the hooks', () => {
  const out = tool('plan.mjs', 'start', '000001', '--repo', 'api');
  assert.match(out, /hook self-test passed/);
  assert.equal(git(wtApi(), 'branch', '--show-current').trim(), 'feat/000001-checkout-payments');
});

test('hooks enforce Conventional Commits, Plan, Task and Refs in the api worktree', () => {
  const wt = wtApi();
  write(join(wt, 'src/payments/payments.service.ts'), 'export class PaymentsService {\n  charge() {\n    return true;\n  }\n}\n');
  write(join(wt, 'src/payments/payments.service.spec.ts'), "it('CHECKOUT-PAY-1: charges the card', () => {});\n");
  git(wt, 'add', '-A');
  gitFails(wt, 'commit', '-m', 'charge the card', '--trailer', 'Task: 1');
  gitFails(wt, 'commit', '-m', 'feat(payments): charge the card');
  gitFails(wt, 'commit', '-m', 'feat(payments): charge the card', '--trailer', 'Task: 7');
  gitFails(wt, 'commit', '-m', 'feat(payments): charge the card', '--trailer', 'Task: 1', '--trailer', 'Refs: ADR-0999');
  git(wt, 'commit', '--quiet', '-m', 'feat(payments): charge the card', '--trailer', 'Task: 1', '--trailer', 'Refs: CHECKOUT-PAY-1, ADR-0004');
  assert.match(git(wt, 'log', '-1', '--format=%B'), /^Plan: 000001$/m, 'prepare-commit-msg added the Plan footer');

  write(join(wt, 'src/payments/payments.module.ts'), 'export class PaymentsModule {}\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '--quiet', '--no-verify', '-m', 'feat(payments): module');
  assert.match(gitFails(wt, 'push', 'origin', 'feat/000001-checkout-payments'), /needs a "Task: <n>" footer/);
  git(wt, 'commit', '--quiet', '--amend', '-m', 'feat(payments): payments module', '--trailer', 'Task: 2');
  git(wt, 'push', '--quiet', '-u', 'origin', 'feat/000001-checkout-payments');
  assert.match(tool('plan.mjs', 'status'), /api\s+feat\/000001-checkout-payments\s+in progress, tasks 2\/2/);
  const pr = tool('plan.mjs', 'pr', '000001', '--repo', 'api', '--scope', 'payments');
  assert.match(pr, /TITLE\nfeat\(payments\): checkout payments\n/);
  assert.match(pr, /- \[x\] Task 2: Payments module/);
  assert.match(pr, /\*\*CHECKOUT-PAY-1\*\*/);
  assert.match(pr, /^Plan: 000001\nTask: 1, 2$/m);
});

test('web worktree: lefthook keeps the team hooks and adds the hub hooks', () => {
  const out = tool('plan.mjs', 'start', '000001', '--repo', 'web');
  assert.match(out, /hook self-test passed/);
  const wt = wtWeb();
  write(join(wt, 'e2e/checkout.spec.ts'), "test('CHECKOUT-PAY-2: shows the decline reason', async () => {});\n");
  git(wt, 'add', '-A');
  gitFails(wt, 'commit', '-m', 'feat(checkout): decline message');
  git(wt, 'commit', '--quiet', '-m', 'feat(checkout): decline message', '--trailer', 'Task: 1', '--trailer', 'Refs: CHECKOUT-PAY-2',
    '--trailer', 'Ruling: reused the generic error banner — no design for a decline banner yet — restyle later');
  if (LEFTHOOK) assert.ok(existsSync(join(base, 'team-hook-ran')), "the repository's own lefthook command still runs");
  git(wt, 'push', '--quiet', '-u', 'origin', 'feat/000001-checkout-payments');
});

test('review:start prepares a PR for review with its plan, rulings, criteria and governing documents', () => {
  // The hosting service publishes every PR's head as refs/pull/<n>/head.
  git(webBare, 'update-ref', 'refs/pull/7/head', 'refs/heads/feat/000001-checkout-payments');
  const cfgFile = join(hub, 'hub.config.json');
  const cfgText = readFileSync(cfgFile, 'utf8');
  const cfg = JSON.parse(cfgText);
  cfg.repos.find((r) => r.name === 'web').reviewGuidelines = ['docs/codebases/web/review.md'];
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  // The web map says new code follows a pattern; a pattern must state its rules.
  const pattern = join(hub, 'docs/patterns/feature-folders.md');
  const webMap = join(hub, 'docs/codebases/web/ARCHITECTURE.md');
  const webMapText = readFileSync(webMap, 'utf8');
  write(pattern, '---\ntype: pattern\n---\n# Feature folders\n\nCode is grouped by feature.\n');
  writeFileSync(webMap, `${webMapText}\n## Patterns\n\nNew code follows [Feature folders](../../patterns/feature-folders.md).\n`);
  assert.match(check(), /docs\/patterns\/feature-folders\.md:1 +\[patterns\]/);
  write(pattern, '---\ntype: pattern\n---\n# Feature folders\n\n## Rules\n\n1. Group code by feature — because type folders hide where a feature lives.\n');
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
  try {
    tool('review.mjs', 'start', 'web', '7');
  } finally {
    writeFileSync(cfgFile, cfgText);
    writeFileSync(webMap, webMapText);
    rmSync(join(hub, 'docs/patterns'), { recursive: true });
  }
  const wt = join(hub, '.worktrees/web--review-7');
  assert.equal(git(wt, 'rev-parse', 'HEAD').trim(), git(webBare, 'rev-parse', 'refs/pull/7/head').trim(), "the worktree is at the PR's head");
  const ctx = readFileSync(join(hub, '.reviews/web-7/context.md'), 'utf8');
  assert.match(ctx, /### Planned work 000001/);
  assert.match(ctx, /Tasks with commits in this PR: 1 of 1/);
  assert.match(ctx, /- reused the generic error banner/);
  assert.match(ctx, /\| CHECKOUT-PAY-2 \| yes \| `e2e\/checkout\.spec\.ts` \|/);
  assert.match(ctx, /\| CHECKOUT-PAY-1 \| no \| none in web \|/);
  assert.match(ctx, /`docs\/codebases\/web\/ARCHITECTURE\.md`: the repository's map/);
  assert.match(ctx, /`docs\/codebases\/web\/review\.md`: missing/);
  assert.match(ctx, /`docs\/patterns\/feature-folders\.md`: a pattern new code here follows \(Feature folders\)/);
  assert.match(readFileSync(join(hub, '.reviews/web-7/pr.diff'), 'utf8'), /\+test\('CHECKOUT-PAY-2/);
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/, 'review notes are not hub documents');
  tool('review.mjs', 'cleanup', 'web', '7');
  assert.ok(!existsSync(wt));
  assert.ok(existsSync(join(hub, '.reviews/web-7/context.md')), "the reviewer's notes are kept");
  rmSync(join(hub, '.reviews'), { recursive: true });
});

test('plan:complete refuses before merge, then completes with rulings from footers and the ledger', () => {
  assert.match(toolFails('plan.mjs', 'complete', '000001'), /merge the code PR first/i);
  // The api squash message was edited by hand and lost every footer: --merged recovers it.
  const apiSha = squashMerge(apiBare, 'feat/000001-checkout-payments', 'feat(payments): checkout payments (#11)', 'Checkout by card.');
  const webPr = tool('plan.mjs', 'pr', '000001', '--repo', 'web');
  assert.match(webPr, /^Ruling: reused the generic error banner/m, 'plan:pr carries rulings into the squash body');
  // web merges with a merge commit, not a squash: the pointer must land on the merge commit.
  const webMergeDir = join(base, 'merge-web-mergecommit');
  git(base, 'clone', '--quiet', webBare, webMergeDir);
  git(webMergeDir, 'commit', '--quiet', '--allow-empty', '-m', 'chore: unrelated work lands first');
  git(webMergeDir, 'merge', '--quiet', '--no-ff', 'origin/feat/000001-checkout-payments', '-m', 'Merge pull request #7 from feat/000001-checkout-payments');
  git(webMergeDir, 'push', '--quiet', 'origin', 'main');
  const webMerge = git(webMergeDir, 'rev-parse', 'HEAD').trim();
  void webPr;
  // The web branch disappears everywhere (as when GitHub deletes it on merge): the ruling must
  // survive through the squash commit alone.
  const web = join(hub, 'repos/web');
  rmSync(wtWeb(), { recursive: true, force: true });
  git(web, 'worktree', 'prune');
  git(web, 'branch', '--quiet', '-D', 'feat/000001-checkout-payments');
  git(webBare, 'branch', '--quiet', '-D', 'feat/000001-checkout-payments');
  git(web, 'update-ref', '-d', 'refs/remotes/origin/feat/000001-checkout-payments');
  write(join(wtApi(), '.superpowers/sdd/000001-checkout-payments--api/progress.md'), '# progress\n- Ruling: kept a single charge method — simpler — none\n');
  assert.equal(git(hub, 'branch', '--show-current').trim(), 'main');
  assert.match(toolFails('plan.mjs', 'complete', '000001'), /--merged api=<squash commit sha>/);
  tool('plan.mjs', 'complete', '000001', '--merged', `api=${apiSha}`);

  assert.equal(git(hub, 'branch', '--show-current').trim(), 'docs/000001-checkout-payments-completion');
  const apiPlan = readFileSync(join(hub, 'docs/superpowers/plans/000001-checkout-payments--api.md'), 'utf8');
  assert.doesNotMatch(apiPlan.split('## Execution rules')[1], /- \[ \] \*\*Step/);
  assert.match(apiPlan, /- kept a single charge method/, "ruling from an unfinished run's ledger");
  assert.match(apiPlan, new RegExp(`\\*\\*Merged:\\*\\* \`repos/api@${apiSha.slice(0, 12)}\``));
  assert.match(readFileSync(join(hub, 'docs/superpowers/plans/000001-checkout-payments--web.md'), 'utf8'), /- reused the generic error banner/,
    'with branch and worktree gone, the ruling survives in the merged commits');
  assert.match(readFileSync(join(hub, 'docs/superpowers/specs/000001-checkout-payments-design.md'), 'utf8'), /status: done/);
  assert.equal(git(join(hub, 'repos/api'), 'rev-parse', 'HEAD').trim(), apiSha, 'submodule pointer moved to the merge');
  assert.equal(git(join(hub, 'repos/web'), 'rev-parse', 'HEAD').trim(), webMerge, 'with a merge commit, the pointer lands on it, not on the branch tip');
  const feature = readFileSync(join(hub, 'docs/features/checkout-payments.md'), 'utf8');
  assert.match(feature, /^type: feature$/m);
  assert.match(feature, /## Acceptance criteria\n\n- \*\*CHECKOUT-PAY-1\*\*[^\n]*\n- \*\*CHECKOUT-PAY-2\*\*/, 'criteria moved from the spec');
  const revert = tool('plan.mjs', 'revert', '000001');
  assert.match(revert, new RegExp(`revert --no-edit ${apiSha}`));
  assert.match(revert, /Nothing below has been run/);
});

test('completion PR: check requires the new module documented, then passes', () => {
  assert.match(check(), /repos\/api\/src\/payments\/payments\.module\.ts.*structural file/);
  const map = join(hub, 'docs/codebases/api/ARCHITECTURE.md');
  writeFileSync(map, readFileSync(map, 'utf8') + '- `repos/api/src/payments/payments.module.ts`: charges cards.\n');
  assert.match(check(), /\[doc-impact\].*not ticked/, 'the planned documentation update must be ticked once applied');
  const spec = join(hub, 'docs/superpowers/specs/000001-checkout-payments-design.md');
  writeFileSync(spec, readFileSync(spec, 'utf8').replace('- [ ] `docs/codebases/api/ARCHITECTURE.md`', '- [x] `docs/codebases/api/ARCHITECTURE.md`'));
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'docs(completion): 000001 checkout-payments');
  assert.match(tool('plan.mjs', 'status', '000001'), /\[done\][\s\S]*api\s+feat\/000001-checkout-payments\s+complete/);
  assert.match(tool('plan.mjs', 'pr', '000001', '--completion'), /TITLE\ndocs\(completion\): 000001 checkout-payments[\s\S]*`api`: merged as `repos\/api@/);
});

test('every check rule fails when its rule is broken', () => {
  const feature = join(hub, 'docs/features/checkout-payments.md');
  const apiPlan = join(hub, 'docs/superpowers/plans/000001-checkout-payments--api.md');
  const map = join(hub, 'docs/codebases/api/ARCHITECTURE.md');
  const breakages = [
    ['progress', apiPlan, (t) => t.replace('- [x]', '- [ ]')],
    ['links', feature, (t) => `${t}\nSee [missing](missing.md).\n`],
    ['adr-refs', feature, (t) => `${t}\nAs decided in ADR-0998.\n`],
    ['ac', feature, (t) => `${t}\n- **CHECKOUT-PAY-9** The system shall refund within a day.\n`],
    ['placeholders', feature, (t) => `${t}\nRefund rules TBD.\n`],
    ['code-paths', map, (t) => `${t}\n- \`repos/api/src/billing/billing.service.ts::RefundService\`\n`],
    ['frontmatter', feature, (t) => t.replace('type: feature', 'type: feature\nowner: payments')],
  ];
  for (const [rule, file, mutate] of breakages) {
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, mutate(original));
    assert.match(check(), new RegExp(`\\[${rule}\\]`), `breaking ${rule}`);
    writeFileSync(file, original);
  }
  const extras = [
    ['location', 'docs/notes/meeting.md', '# Notes\n'],
    ['ids', 'docs/superpowers/specs/000001-other-thing-design.md', '---\ntype: design\nstatus: draft\n---\n# Other\n'],
    ['architecture', 'docs/codebases/api/architecture/refunds.md', '---\ntype: architecture-area\npaths:\n  - repos/api/src/refunds/**\n---\n# api: refunds\n'],
  ];
  for (const [rule, rel, text] of extras) {
    write(join(hub, rel), text);
    assert.match(check(), new RegExp(`\\[${rule}\\]`), `breaking ${rule}`);
    rmSync(join(hub, rel));
  }
  const api = join(hub, 'repos/api');
  const tip = git(api, 'rev-parse', 'HEAD').trim();
  git(api, 'checkout', '--quiet', '--detach', 'HEAD~1');
  const out = check();
  assert.match(out, /\[completion\]/);
  assert.match(out, /\[ac\].*CHECKOUT-PAY-1 has no test/);
  git(api, 'checkout', '--quiet', '--detach', tip);
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
});

test('plan:cleanup waits for the completion PR, then removes worktrees and branches', () => {
  assert.match(toolFails('plan.mjs', 'cleanup', '000001'), /merge the completion PR/);
  assert.match(run(hub, 'node', ['tools/doctor.mjs'], { ok: false }), /belongs to completed plan 000001/);
  git(hub, 'switch', '--quiet', 'main');
  git(hub, 'merge', '--quiet', '--squash', 'docs/000001-checkout-payments-completion');
  assert.match(check(), /repos\/api is checked out at .* but the hub points at/);
  git(hub, 'submodule', 'update', '--quiet');
  git(hub, 'commit', '--quiet', '-m', 'docs(completion): 000001 checkout-payments (#2)');
  git(hub, 'push', '--quiet', 'origin', 'main');
  tool('plan.mjs', 'cleanup', '000001');
  assert.ok(!existsSync(wtApi()) && !existsSync(wtWeb()));
  assert.equal(git(join(hub, 'repos/api'), 'branch', '--list', 'feat/000001-checkout-payments').trim(), '');
  assert.match(tool('doctor.mjs'), /\[doctor\] ok/);
});

test('work:start gives bounded work a fresh worktree without plan footers', () => {
  toolFails('plan.mjs', 'work-start', 'api', 'feat/000009-sneaky');
  toolFails('plan.mjs', 'work-start', 'api', 'Fix/Rounding');
  assert.match(tool('plan.mjs', 'work-start', 'api', 'fix/invoice-rounding'), /hook self-test passed/);
  const wt = join(hub, '.worktrees', 'api--invoice-rounding');
  write(join(wt, 'src/billing/round.ts'), 'export const round = (n: number) => Math.round(n);\n');
  git(wt, 'add', '-A');
  gitFails(wt, 'commit', '-m', 'round invoices');
  git(wt, 'commit', '--quiet', '-m', 'fix(billing): round invoice totals', '--trailer', 'Refs: BILL-ISSUE-1');
  assert.doesNotMatch(git(wt, 'log', '-1', '--format=%B'), /Plan:/);
  git(wt, 'reset', '--quiet', '--hard', 'HEAD~1');
  tool('plan.mjs', 'work-cleanup', 'api', 'fix/invoice-rounding');
  assert.ok(!existsSync(wt));
});

test('repo:sync moves a pointer to the merged default branch and stages it', () => {
  const api = join(hub, 'repos/api');
  const before = git(api, 'rev-parse', 'HEAD').trim();
  const dir = join(base, 'api-sync');
  git(base, 'clone', '--quiet', apiBare, dir);
  write(join(dir, 'src/billing/round.ts'), 'export const round = (n: number) => Math.round(n * 100) / 100;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'fix(billing): round invoice totals to the cent');
  git(dir, 'push', '--quiet', 'origin', 'main');
  const merged = git(dir, 'rev-parse', 'HEAD').trim();

  write(join(api, 'scratch.txt'), 'edited in the submodule\n');
  assert.match(toolFails('repo.mjs', 'sync', 'api'), /has local changes/);
  rmSync(join(api, 'scratch.txt'));

  assert.match(tool('repo.mjs', 'sync', 'api'), /repos\/api: \w+ -> \w+ \(1 commit\(s\) from origin\/main\); pointer staged/);
  assert.equal(git(api, 'rev-parse', 'HEAD').trim(), merged);
  assert.match(git(hub, 'ls-files', '-s', '--', 'repos/api'), new RegExp(`^160000 ${merged} `));
  assert.match(tool('repo.mjs', 'sync', 'api'), /already at origin\/main/);

  // A commit made directly in the checkout, on no branch, is not left behind silently.
  write(join(api, 'src/billing/stray.ts'), 'export {};\n');
  git(api, 'add', '-A');
  git(api, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'chore: stray commit');
  assert.match(toolFails('repo.mjs', 'sync', 'api'), /which no branch contains/);

  git(api, 'checkout', '--quiet', '--detach', before);
  git(hub, 'reset', '--quiet', '--', 'repos/api');
});

test('the next plan gets 000002', () => {
  assert.match(tool('plan.mjs', 'new', 'refunds', '--repos', 'api'), /000002/);
});

test('plan:abandon refuses shipped work and drops an unmerged design', () => {
  assert.match(toolFails('plan.mjs', 'abandon', '000001', '--reason', 'changed our mind'), /already merged in repos\/(api|web); undo it with pnpm plan:revert 000001/);
  toolFails('plan.mjs', 'abandon', '000002');
  const out = tool('plan.mjs', 'abandon', '000002', '--reason', 'refunds move to the payment provider');
  assert.match(out, /never reached main[\s\S]*git branch -D docs\/000002-refunds-spec/);
});

test('contracts must cite code on both sides and be linked from the system map', () => {
  git(hub, 'switch', '--quiet', 'main');
  const contract = join(hub, 'docs/contracts/billing-api.md');
  write(contract, '---\ntype: contract\nprovider: api\nconsumers: [web]\n---\n# Billing API\n\nInvoices are issued by `repos/api/src/billing/billing.service.ts::BillingService`.\n');
  let out = check();
  assert.match(out, /\[contracts\].*cite the code that implements this contract in web/);
  assert.match(out, /\[contracts\].*link docs\/contracts\/billing-api\.md/);
  writeFileSync(contract, readFileSync(contract, 'utf8') + '\nThe web app shows them from `repos/web/app/(shop)/layout.tsx`.\n');
  const arch = join(hub, 'docs/ARCHITECTURE.md');
  const archBefore = readFileSync(arch, 'utf8');
  writeFileSync(arch, archBefore.replace('## Evolution', '## How the repositories interact\n\n- [Billing API](contracts/billing-api.md)\n\n## Evolution'));
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
  rmSync(contract);
  writeFileSync(arch, archBefore);
});

test('epics: the PRD is stored, every requirement mapped, phases cite only known requirements', () => {
  const prdFile = join(base, 'prd-input.md');
  writeFileSync(prdFile, '# Faster checkout\n\n## Requirements\n\n- **REQ-1** Pay with a saved card.\n- **REQ-2** Reuse the last address.\n');
  const out = tool('plan.mjs', 'epic-new', 'faster-checkout', '--prd', prdFile);
  assert.match(out, /docs\/epics\/faster-checkout\/README\.md/);
  assert.equal(git(hub, 'branch', '--show-current').trim(), 'docs/epic-faster-checkout');
  assert.match(readFileSync(join(hub, 'docs/epics/faster-checkout/prd.md'), 'utf8'), /^---\ntype: prd\n---\n# Faster checkout/);
  const readme = join(hub, 'docs/epics/faster-checkout/README.md');
  const epic = (map, status = 'approved', phaseLink = 'not started') => `---\ntype: epic\nstatus: ${status}\n---\n# Faster checkout\n\n## Outcome\n\nRepeat customers check out faster.\n\n## Requirement map\n\n| Requirement | Phase |\n|---|---|\n${map}\n\n## Phases\n\n| # | Phase | Tier | Work | Status |\n|---|---|---|---|---|\n| 1 | Saved cards | Architectural | ${phaseLink} | planned |\n\n## Links\n\n- [prd.md](prd.md)\n`;
  write(readme, epic('| REQ-1 | 1 |'));
  assert.match(check(), /\[epics\].*REQ-2 from the PRD is not in the requirement map/);
  write(readme, epic('| REQ-1 | 1 |\n| REQ-2 | Out of scope: later epic |'));
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
  write(readme, epic('| REQ-1 | 1 |\n| REQ-2 | Out of scope: later epic |', 'done'));
  assert.match(check(), /\[epics\].*the epic is done but phase "Saved cards" links no design spec/);
  write(readme, epic('| REQ-1 | 1 |\n| REQ-2 | Out of scope: later epic |'));
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'docs(epic): faster-checkout');
  git(hub, 'switch', '--quiet', 'main');
  git(hub, 'merge', '--quiet', '--squash', 'docs/epic-faster-checkout');
  git(hub, 'commit', '--quiet', '-m', 'docs(epic): faster-checkout (#5)');
  git(hub, 'push', '--quiet', 'origin', 'main');

  assert.match(tool('plan.mjs', 'new', 'saved-cards', '--repos', 'api', '--epic', 'faster-checkout'), /000003[\s\S]*- Epic: \[faster-checkout\]\(\.\.\/\.\.\/epics\/faster-checkout\/README\.md\)/);
  toolFails('plan.mjs', 'new', 'nope', '--repos', 'api', '--epic', 'missing-epic');
  write(join(hub, 'docs/superpowers/specs/000003-saved-cards-design.md'), '---\ntype: design\nstatus: draft\n---\n# Saved cards\n\n## Acceptance criteria\n\n- **CARD-1** When a customer pays with a saved card, the system shall charge it. (REQ-9)\n\n## Links\n\n- Epic: [faster-checkout](../../epics/faster-checkout/README.md)\n- Feature: `docs/features/cards.md`\n');
  assert.match(check(), /\[epics\].*REQ-9 is not defined in the epic's prd\.md/);
  const spec = join(hub, 'docs/superpowers/specs/000003-saved-cards-design.md');
  writeFileSync(spec, readFileSync(spec, 'utf8').replace('(REQ-9)', '(REQ-1)'));
  assert.match(run(hub, 'node', ['tools/docs-check.mjs']), /\[check\] ok/);
  assert.match(tool('plan.mjs', 'status'), /epic   faster-checkout  \[approved\]  1 phase\(s\)/);
});
