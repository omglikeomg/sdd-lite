// GitHub mode end to end against a fake `gh` (tools/test/fake-gh): tracking issues as work IDs,
// labels moved by commands, explanatory comments, PRs, and bounded work started from a bug issue.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makePristineHub } from './fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const base = mkdtempSync(join(tmpdir(), 'hub-gh-'));
const hub = join(base, 'hub');
const STATE = join(base, 'gh-state.json');
writeFileSync(join(base, 'gitconfig'), '[user]\n  name = Hub Test\n  email = hub-test@example.com\n[init]\n  defaultBranch = main\n[protocol "file"]\n  allow = always\n[commit]\n  gpgsign = false\n[advice]\n  detachedHead = false\n');
const ENV = {
  ...process.env,
  PATH: `${join(HERE, 'fake-gh')}:${process.env.PATH}`,
  FAKE_GH_STATE: STATE,
  GIT_CONFIG_GLOBAL: join(base, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  HUB_SKIP_GRAPHIFY: '1',
};
after(() => (process.env.HUB_KEEP_E2E === '1' ? console.log(`kept ${base}`) : rmSync(base, { recursive: true, force: true })));

function run(cwd, cmd, args, { ok = true, env = ENV } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  if (ok && r.status !== 0) assert.fail(`${cmd} ${args.join(' ')} exited ${r.status}:\n${out}`);
  if (!ok && r.status === 0) assert.fail(`${cmd} ${args.join(' ')} should have failed:\n${out}`);
  return out;
}
const git = (cwd, ...a) => run(cwd, 'git', a);
const tool = (script, ...a) => run(hub, 'node', [`tools/${script}`, ...a]);
const toolFails = (script, ...a) => run(hub, 'node', [`tools/${script}`, ...a], { ok: false });
const write = (f, t) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const gh = () => JSON.parse(readFileSync(STATE, 'utf8'));
const issue = (n) => gh().issues[`acme/hub#${n}`];
// What a merge does to the fake: the PR is no longer open.
function gh_state_close(key) {
  const s = gh();
  s.prs[key].state = 'MERGED';
  writeFileSync(STATE, JSON.stringify(s));
}

function squashMerge(bare, branch, message) {
  const dir = join(base, `merge-${Date.now()}`);
  git(base, 'clone', '--quiet', bare, dir);
  git(dir, 'merge', '--quiet', '--squash', `origin/${branch}`);
  git(dir, 'commit', '--quiet', '-m', message);
  git(dir, 'push', '--quiet', 'origin', 'main');
}

let apiBare;

test('setup: hub, product repo, gh:setup creates labels and records slugs', () => {
  const src = join(base, 'api-src');
  mkdirSync(src);
  git(src, 'init', '--quiet');
  write(join(src, 'src/billing/billing.module.ts'), 'export class BillingModule {}\n');
  write(join(src, 'src/billing/billing.service.spec.ts'), "it('BILL-ISSUE-1: issues an invoice', () => {});\n");
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'chore: initial');
  apiBare = join(base, 'api.git');
  git(base, 'clone', '--quiet', '--bare', src, apiBare);

  makePristineHub(hub);
  git(hub, 'init', '--quiet');
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'chore: initial hub');
  git(base, 'clone', '--quiet', '--bare', hub, join(base, 'hub.git'));
  git(hub, 'remote', 'add', 'origin', join(base, 'hub.git'));
  git(hub, 'fetch', '--quiet', 'origin');
  git(hub, 'branch', '--quiet', '--set-upstream-to=origin/main');

  tool('repo.mjs', 'add', 'api', apiBare, '--preset', 'nest', '--github', 'acme/api');
  write(join(hub, 'docs/codebases/api/ARCHITECTURE.md'), '---\ntype: architecture\n---\n# api\n\n- `repos/api/src/billing/billing.module.ts`: invoices.\n');
  const arch = join(hub, 'docs/ARCHITECTURE.md');
  writeFileSync(arch, readFileSync(arch, 'utf8').replace('|---|---|---|\n', '|---|---|---|\n| api | [map](codebases/api/ARCHITECTURE.md) | HTTP API |\n'));
  write(join(hub, 'docs/features/billing.md'), '---\ntype: feature\n---\n# Billing\n\n- **BILL-ISSUE-1** When an order is paid, the system shall issue an invoice.\n');
  tool('setup.mjs');

  toolFails('gh-setup.mjs');
  const out = tool('gh-setup.mjs', '--hub-repo', 'acme/hub');
  assert.match(out, /GitHub mode on; tracking issues live in acme\/hub/);
  const cfg = JSON.parse(readFileSync(join(hub, 'hub.config.json'), 'utf8'));
  assert.deepEqual(cfg.github, { enabled: true, hubRepo: 'acme/hub' });
  assert.equal(cfg.repos[0].github, 'acme/api');
  for (const l of ['status:ongoing', 'status:pending-review', 'status:needs-manual-steps', 'tier:architectural', 'type:feat', 'repo:api', 'breaking-change', 'priority:p1', 'kind:bug']) {
    assert.ok(gh().labels['acme/hub'].includes(l), `label ${l}`);
  }
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'chore(repos): add api with github mode');
  git(hub, 'push', '--quiet', 'origin', 'main');
});

test('GitHub mode refuses to run when gh is not logged in', () => {
  const out = run(hub, 'node', ['tools/plan.mjs', 'new', 'x', '--repos', 'api'], { ok: false, env: { ...ENV, FAKE_GH_AUTH_FAIL: '1' } });
  assert.match(out, /gh auth login/);
});

test('plan:new adopts a PM feature request as the tracking issue; its number is the ID', () => {
  const s = gh();
  s.issues['acme/hub#41'] = { number: 41, title: 'Customers want to pay with a saved card', body: 'Problem: returning customers retype card details.', url: 'https://github.com/acme/hub/issues/41', state: 'OPEN', labels: ['kind:feature'], comments: [] };
  s.next = 42;
  writeFileSync(STATE, JSON.stringify(s));
  const out = tool('plan.mjs', 'new', 'saved-cards', '--repos', 'api', '--issue', '41');
  assert.match(out, /allocated ID 000041/);
  assert.equal(git(hub, 'branch', '--show-current').trim(), 'docs/000041-saved-cards-spec');
  assert.deepEqual(issue(41).labels.sort(), ['kind:feature', 'repo:api', 'status:ongoing', 'tier:architectural', 'type:feat']);
  assert.match(issue(41).comments[0].body, /### Design started[\s\S]*planned work \*\*000041\*\*/);
  assert.match(issue(41).body, /retype card details/, 'the PM\'s description is kept');
});

test('spec PR: --create pushes the branch, opens the PR, explains the design, marks pending review', () => {
  write(join(hub, 'docs/superpowers/specs/000041-saved-cards-design.md'), `---
type: design
status: approved
---
# Saved cards: design

## Goal

Returning customers pay with a card they saved before.

## Context

Billing lives in \`repos/api/src/billing/billing.module.ts\`.

## Acceptance criteria

- **CARD-PAY-1** When a customer pays with a saved card, the system shall charge that card.

## Documentation impact

- None: the test fixture changes no living document.

## Manual steps

- Set \`CARD_VAULT_KEY\` in production before deploying.

## Links

- Feature: \`docs/features/saved-cards.md\`
`);
  write(join(hub, 'docs/superpowers/plans/000041-saved-cards--api.md'), `# Saved cards (api) Implementation Plan

**Goal:** Charge saved cards.

**Spec:** [000041 design](../specs/000041-saved-cards-design.md)

**Repo:** \`repos/api\`

**Branch:** \`feat/000041-saved-cards\`

---

### Task 1: Charge a saved card

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Commit**
`);
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'docs(spec): 000041 saved-cards');
  const out = tool('plan.mjs', 'pr', '000041', '--spec', '--create');
  assert.match(out, /GitHub: opened https:\/\/github.com\/acme\/hub\/pull\/42/);
  assert.match(git(join(base, 'hub.git'), 'branch', '--list', 'docs/000041-saved-cards-spec'), /docs\/000041/, 'branch pushed');
  assert.match(gh().prs['acme/hub#42'].body, /Tracking issue: #41/);
  assert.match(issue(41).comments[1].body, /### Design ready for review[\s\S]*CARD-PAY-1[\s\S]*pull\/42/);
  assert.ok(issue(41).labels.includes('status:pending-review') && !issue(41).labels.includes('status:ongoing'));
  const again = tool('plan.mjs', 'pr', '000041', '--spec', '--create');
  assert.match(again, /reusing the open PR https:\/\/github.com\/acme\/hub\/pull\/42/);
  assert.equal(issue(41).comments.length, 2, 'a rerun does not comment twice');
  assert.equal(Object.keys(gh().prs).length, 1, 'a rerun does not open a second PR');
  gh_state_close('acme/hub#42');
});

test('plan:new without --issue creates a tracking issue and takes its number', () => {
  git(hub, 'switch', '--quiet', 'main');
  git(hub, 'merge', '--quiet', '--squash', 'docs/000041-saved-cards-spec');
  git(hub, 'commit', '--quiet', '-m', 'docs(spec): 000041 saved-cards (#42)');
  git(hub, 'push', '--quiet', 'origin', 'main');
  const out = tool('plan.mjs', 'new', 'refunds', '--repos', 'api', '--title', 'Refund a payment');
  assert.match(out, /allocated ID 000043/);
  assert.equal(issue(43).title, 'Refund a payment');
  assert.match(issue(43).body, /\*\*Work 000043\*\*/);
  git(hub, 'switch', '--quiet', 'main');
  const abandoned = tool('plan.mjs', 'abandon', '000043', '--reason', 'Refunds will be handled by the payment provider.');
  assert.match(abandoned, /closed acme\/hub#43 as not planned/);
  assert.equal(issue(43).state, 'CLOSED');
  assert.equal(issue(43).stateReason, 'not planned');
  assert.ok(!issue(43).labels.some((l) => l.startsWith('status:')));
  assert.match(issue(43).comments.at(-1).body, /### Abandoned[\s\S]*\*\*Why:\*\* Refunds will be handled by the payment provider\.[\s\S]*never merged into the hub/);
  git(hub, 'branch', '--quiet', '-D', 'docs/000043-refunds-spec');
});

test('code PR: opened in the product repo, linked to the tracking issue, rulings and breaking change surfaced', () => {
  const out = tool('plan.mjs', 'start', '000041', '--repo', 'api');
  assert.match(out, /hook self-test passed/);
  assert.ok(issue(41).labels.includes('status:ongoing'));
  const wt = join(hub, '.worktrees', 'api--000041-saved-cards');
  write(join(wt, 'src/billing/saved-card.spec.ts'), "it('CARD-PAY-1: charges the saved card', () => {});\n");
  git(wt, 'add', '-A');
  git(wt, 'commit', '--quiet', '-m', 'feat(billing)!: charge saved cards', '--trailer', 'Task: 1', '--trailer', 'Refs: CARD-PAY-1',
    '--trailer', 'Ruling: stored only the vault token — no card data in our database — none');
  const pr = tool('plan.mjs', 'pr', '000041', '--repo', 'api', '--scope', 'billing', '--create');
  assert.match(pr, /GitHub: opened https:\/\/github.com\/acme\/api\/pull\/44/);
  const body = gh().prs['acme/api#44'].body;
  assert.match(body, /^## Context\n\nCharge saved cards\.\n\nDesign: `docs\/superpowers\/specs\/000041-saved-cards-design\.md` in the hub · tracking issue acme\/hub#41\./);
  assert.match(body, /## What changed\n\n- \[x\] Task 1: Charge a saved card\n\n- `src\/billing\/saved-card\.spec\.ts` \(added\)/);
  assert.match(body, /## Decisions made during implementation\n\n- stored only the vault token/);
  assert.match(body, /## How it was verified\n\nTests that prove an acceptance criterion are titled with its ID\.\n\nTests added or changed:\n\n- `src\/billing\/saved-card\.spec\.ts`/);
  assert.match(body, /^Plan: 000041\nTask: 1\nRuling: stored only the vault token/m);
  const c = issue(41).comments[2].body;
  assert.match(c, /### Code ready for review in `api`[\s\S]*pull\/44[\s\S]*stored only the vault token/);
  assert.ok(issue(41).labels.includes('status:pending-review'));
  assert.ok(issue(41).labels.includes('breaking-change'), '! in a commit header marks the work as breaking');
  squashMerge(apiBare, 'feat/000041-saved-cards', `feat(billing)!: saved cards (#44)\n\n${body}`);
});

test('completion PR: closes the issue with context and flags manual steps', () => {
  tool('plan.mjs', 'complete', '000041');
  git(hub, 'commit', '--quiet', '-m', 'docs(completion): 000041 saved-cards');
  const out = tool('plan.mjs', 'pr', '000041', '--completion', '--create');
  assert.match(out, /pull\/45/);
  assert.match(gh().prs['acme/hub#45'].body, /Closes #41/);
  assert.match(gh().prs['acme/hub#45'].body, /## Manual steps still needed[\s\S]*CARD_VAULT_KEY/);
  const c = issue(41).comments[3].body;
  assert.match(c, /### Shipped[\s\S]*`api`: merged as[\s\S]*Manual steps still needed[\s\S]*CARD_VAULT_KEY[\s\S]*stored only the vault token[\s\S]*Merging it closes this issue; the manual steps/);
  assert.ok(issue(41).labels.includes('status:needs-manual-steps') && !issue(41).labels.includes('status:pending-review'));
  git(hub, 'switch', '--quiet', 'main');
});

test('bounded work from a bug issue: context in, explanation and PR back out', () => {
  const s = gh();
  s.issues['acme/hub#46'] = { number: 46, title: 'Invoice totals off by a cent', body: 'Totals like 10.005 round down.', url: 'https://github.com/acme/hub/issues/46', state: 'OPEN', labels: ['kind:bug'],
    comments: [{ author: { login: 'pm' }, createdAt: '2026-10-07T09:00:00Z', body: 'Seen on order 1234.' }] };
  s.next = 47;
  writeFileSync(STATE, JSON.stringify(s));
  const out = tool('plan.mjs', 'work-start', 'api', 'fix/invoice-rounding', '--issue', '46');
  assert.match(out, /hook self-test passed/);
  const ctx = readFileSync(join(hub, '.worktrees', 'api--invoice-rounding.issue.md'), 'utf8');
  assert.match(ctx, /# acme\/hub#46: Invoice totals off by a cent[\s\S]*round down[\s\S]*Seen on order 1234/);
  assert.ok(issue(46).labels.includes('tier:bounded') && issue(46).labels.includes('status:ongoing'));
  assert.match(issue(46).comments.at(-1).body, /### Work started/);

  const wt = join(hub, '.worktrees', 'api--invoice-rounding');
  write(join(wt, 'src/billing/round.ts'), 'export const round = (n: number) => Math.round(n * 100) / 100;\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '--quiet', '-m', 'fix(billing): round invoice totals half-up', '-m', 'Cause: totals were truncated with Math.floor.\nFix: round half-up to cents.', '--trailer', 'Refs: BILL-ISSUE-1');
  const pr = tool('plan.mjs', 'work-pr', 'api', 'fix/invoice-rounding', '--create');
  assert.match(pr, /TITLE\nfix\(billing\): round invoice totals half-up/);
  const body = gh().prs['acme/api#47'].body;
  assert.match(body, /^## Context\n\nReported in acme\/hub#46: \*\*Invoice totals off by a cent\*\*\./);
  assert.match(body, /## Root cause\n\ntotals were truncated with Math\.floor\.\n\n## What changed\n\nround half-up to cents\./);
  assert.match(body, /`src\/billing\/round\.ts` \(added\)/);
  assert.match(body, /## How it was verified\n\nNo tests were added or changed/);
  assert.match(body, /\n\nFixes acme\/hub#46\nRefs: BILL-ISSUE-1$/);
  assert.match(issue(46).comments.at(-1).body, /### Fix ready for review in `api`[\s\S]*\*\*Root cause:\*\* totals were truncated[\s\S]*\*\*Fix:\*\* round half-up[\s\S]*pull\/47\. Merging it closes this issue/);
  assert.ok(issue(46).labels.includes('status:pending-review'));
  tool('plan.mjs', 'work-cleanup', 'api', 'fix/invoice-rounding');
  assert.ok(!existsSync(join(hub, '.worktrees', 'api--invoice-rounding.issue.md')));
});

test('epics in GitHub mode: adopted issue, design PR, phases as sub-issues, epic labels on PRs', () => {
  const s = gh();
  s.issues['acme/hub#60'] = { number: 60, title: 'PRD: faster repeat checkout', body: 'See attached PRD.', url: 'https://github.com/acme/hub/issues/60', state: 'OPEN', labels: ['kind:feature'], comments: [] };
  s.next = 61;
  writeFileSync(STATE, JSON.stringify(s));
  git(hub, 'switch', '--quiet', 'main');
  const prdFile = join(base, 'prd.md');
  writeFileSync(prdFile, '# Faster checkout\n\n- **REQ-1** Reuse the last shipping address.\n');
  tool('plan.mjs', 'epic-new', 'faster-checkout', '--prd', prdFile, '--issue', '60');
  assert.ok(['tier:epic', 'epic:faster-checkout', 'status:ongoing'].every((l) => issue(60).labels.includes(l)));
  assert.match(issue(60).comments.at(-1).body, /### Epic design started/);
  write(join(hub, 'docs/epics/faster-checkout/README.md'), '---\ntype: epic\nstatus: approved\nissue: 60\n---\n# Faster checkout\n\n## Outcome\n\nReturning customers reuse their last address.\n\n## Requirement map\n\n| Requirement | Phase |\n|---|---|\n| REQ-1 | 1 |\n\n## Phases\n\n| # | Phase | Tier | Work | Status |\n|---|---|---|---|---|\n| 1 | Saved addresses | Architectural | not started | planned |\n');
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', 'docs(epic): faster-checkout');
  const epicPr = tool('plan.mjs', 'epic-pr', 'faster-checkout', '--create');
  const prKey = Object.keys(gh().prs).find((k) => gh().prs[k].head === 'docs/epic-faster-checkout');
  assert.match(epicPr, /TITLE\ndocs\(epic\): faster-checkout/);
  assert.deepEqual(gh().prs[prKey].labels, ['epic:faster-checkout']);
  assert.match(gh().prs[prKey].body, /REQ-1[\s\S]*Saved addresses[\s\S]*Refs #60/);
  assert.match(issue(60).comments.at(-1).body, /### Epic design ready for review[\s\S]*Saved addresses/);
  assert.ok(issue(60).labels.includes('status:pending-review'));
  gh_state_close(prKey);
  git(hub, 'switch', '--quiet', 'main');
  git(hub, 'merge', '--quiet', '--squash', 'docs/epic-faster-checkout');
  git(hub, 'commit', '--quiet', '-m', 'docs(epic): faster-checkout (#62)');
  git(hub, 'push', '--quiet', 'origin', 'main');

  const out = tool('plan.mjs', 'new', 'saved-addresses', '--repos', 'api', '--epic', 'faster-checkout');
  const phaseNo = Number(/allocated ID (\d{6})/.exec(out)[1]);
  assert.match(out, new RegExp(`#${phaseNo} is a sub-issue of epic #60`));
  assert.deepEqual(issue(60).subIssues, [phaseNo]);
  assert.ok(issue(phaseNo).labels.includes('epic:faster-checkout'));

  const id = String(phaseNo).padStart(6, '0');
  write(join(hub, `docs/superpowers/specs/${id}-saved-addresses-design.md`), `---\ntype: design\nstatus: approved\n---\n# Saved addresses\n\n## Goal\n\nReuse the last address.\n\n## Acceptance criteria\n\n- **ADDR-1** When a returning customer checks out, the system shall offer their last address. (REQ-1)\n\n## Documentation impact\n\n- None: no living document changes.\n\n## Links\n\n- Epic: [faster-checkout](../../epics/faster-checkout/README.md)\n- Feature: \`docs/features/addresses.md\`\n`);
  write(join(hub, `docs/superpowers/plans/${id}-saved-addresses--api.md`), `# Saved addresses (api) Implementation Plan\n\n**Goal:** Offer the last address.\n\n**Spec:** [design](../specs/${id}-saved-addresses-design.md)\n\n**Repo:** \`repos/api\`\n\n**Branch:** \`feat/${id}-saved-addresses\`\n\n---\n\n### Task 1: Last address\n\n- [ ] **Step 1: Test**\n`);
  git(hub, 'add', '-A');
  git(hub, 'commit', '--quiet', '-m', `docs(spec): ${id} saved-addresses`);
  tool('plan.mjs', 'pr', id, '--spec', '--create');
  const specPr = Object.values(gh().prs).find((p) => p.head === `docs/${id}-saved-addresses-spec`);
  assert.deepEqual(specPr.labels, ['epic:faster-checkout']);
  gh_state_close(`acme/hub#${specPr.number}`);
  git(hub, 'switch', '--quiet', 'main');
  git(hub, 'merge', '--quiet', '--squash', `docs/${id}-saved-addresses-spec`);
  git(hub, 'commit', '--quiet', '-m', `docs(spec): ${id} saved-addresses (#${specPr.number})`);
  git(hub, 'push', '--quiet', 'origin', 'main');

  tool('plan.mjs', 'start', id, '--repo', 'api');
  const wt = join(hub, '.worktrees', `api--${id}-saved-addresses`);
  write(join(wt, 'src/billing/address.spec.ts'), "it('ADDR-1: offers the last address', () => {});\n");
  git(wt, 'add', '-A');
  git(wt, 'commit', '--quiet', '-m', 'feat(billing): offer the last address', '--trailer', 'Task: 1', '--trailer', 'Refs: ADDR-1');
  tool('plan.mjs', 'pr', id, '--repo', 'api', '--create');
  const codePr = Object.entries(gh().prs).find(([k, p]) => k.startsWith('acme/api#') && p.head === `feat/${id}-saved-addresses`)[1];
  assert.deepEqual(codePr.labels, ['epic:faster-checkout']);
  assert.ok(gh().labels['acme/api'].includes('epic:faster-checkout'), 'the epic label is created in the product repository');
});
