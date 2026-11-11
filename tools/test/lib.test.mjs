import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlanBranch, branchNameError, commitHeaderError, cleanMessage, footerValues, taskNumbers, isAcId,
  parseSpecFilename, parsePlanFilename, TEST_TITLE_AC_RE, adrLabel, testTitleCriteria,
} from '../lib/conventions.mjs';
import { weakenedChecks } from '../lib/floor.mjs';
import { splitFrontmatter, setFrontmatterValue, stripCode, codeSpans, links, section } from '../lib/markdown.mjs';
import { globToRegExp, matchesAny } from '../lib/glob.mjs';
import { parsePlan, tickTasks, rulingsFromLedger, blockedByError } from '../lib/plans.mjs';
import { criteriaBlocks, criteriaByFeature, mergeCriteria, newFeatureDoc, splitCriteria, removeCriteria } from '../lib/features.mjs';
import { loadAcDefinitions } from '../lib/hub.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explanationSections, fixPrBody, featurePrBody, oneWaySigns } from '../lib/pr-text.mjs';
import { glossaryProblems } from '../lib/glossary.mjs';

test('plan branches carry type, six-digit ID and slug', () => {
  assert.deepEqual(parsePlanBranch('feat/000042-checkout-payments'), { type: 'feat', id: '000042', slug: 'checkout-payments' });
  assert.equal(parsePlanBranch('feat/42-checkout'), null);
  assert.equal(parsePlanBranch('feature/000042-x'), null);
  assert.equal(branchNameError('fix/login-redirect'), null);
  assert.equal(branchNameError('fix/2fa-prompt'), null);
  assert.match(branchNameError('feat/42-checkout'), /6-digit/);
  assert.match(branchNameError('feat/Checkout'), /must be/);
  assert.equal(branchNameError('release/2026-10'), null);
});

test('spec and plan filenames', () => {
  assert.deepEqual(parseSpecFilename('000042-checkout-payments-design.md'), { id: '000042', slug: 'checkout-payments' });
  assert.deepEqual(parsePlanFilename('000042-checkout-payments--api.md'), { id: '000042', slug: 'checkout-payments', repo: 'api' });
  assert.equal(parsePlanFilename('2026-10-08-checkout.md'), null);
});

test('conventional commit headers', () => {
  assert.equal(commitHeaderError('feat(payments): charge saved card'), null);
  assert.equal(commitHeaderError('fix!: drop legacy token format'), null);
  assert.equal(commitHeaderError('fixup! feat(payments): charge saved card'), null);
  assert.match(commitHeaderError('Added checkout'), /Conventional Commit/);
  assert.match(commitHeaderError('feat:missing space'), /Conventional Commit/);
});

test('footers are read anywhere in the message, comments and scissors ignored', () => {
  const msg = cleanMessage('feat: x\n\n* feat: a\n\nPlan: 000042\nTask: 1\n\n* feat: b\n\nPlan: 000042\nTask: 2, 3\n# Task: 9\n# ------------------------ >8 ------------------------\nTask: 8\n');
  assert.deepEqual(footerValues(msg, 'Plan'), ['000042', '000042']);
  assert.deepEqual([...taskNumbers(msg)], [1, 2, 3]);
});

test('acceptance-criteria IDs exclude ADR and RFC', () => {
  assert.ok(isAcId('BILL-ISSUE-1'));
  assert.ok(isAcId('CHECKOUT-PAY-12'));
  assert.ok(!isAcId('ADR-0003'));
  assert.ok(!isAcId('RFC-7231'));
  assert.ok(!isAcId('bill-issue-1'));
  const src = "it('BILL-ISSUE-1: issues', () => {});\ntest.describe(\"CHECKOUT-PAY-2: flow\", () => {});\nit('UTF-8 handling')\nit.each([\n  ['a', 1],\n])('COMPARE-PAGE-4: %s asks for ids', () => {});\nexpect(x).toBe('NOT-AN-ID-1')";
  assert.deepEqual([...src.matchAll(TEST_TITLE_AC_RE)].map((m) => m[1]), ['BILL-ISSUE-1', 'CHECKOUT-PAY-2', 'COMPARE-PAGE-4']);
  assert.equal(adrLabel('7'), 'ADR-0007');
});

test('skipped and todo tests are not proof of a criterion', () => {
  const src = [
    "it('BILL-ISSUE-1: issues', () => {});",
    "it.skip('BILL-ISSUE-2: refunds', () => {});",
    "test.todo('BILL-ISSUE-3: voids');",
    "xit('BILL-ISSUE-4: x', () => {});",
    "xtest('BILL-ISSUE-5: x', () => {});",
    "test.fixme('BILL-ISSUE-6: x', async () => {});",
    "it.skip.each([['a', 1]])('BILL-ISSUE-7: %s', () => {});",
    "xdescribe('BILL-ISSUE-8: group', () => {});",
    "test.describe('BILL-ISSUE-9: group', () => {});",
  ].join('\n');
  assert.deepEqual(testTitleCriteria(src).map((c) => [c.id, c.skipped]), [
    ['BILL-ISSUE-1', false], ['BILL-ISSUE-2', true], ['BILL-ISSUE-3', true], ['BILL-ISSUE-4', true], ['BILL-ISSUE-5', true],
    ['BILL-ISSUE-6', true], ['BILL-ISSUE-7', true], ['BILL-ISSUE-8', true], ['BILL-ISSUE-9', false],
  ]);
  assert.deepEqual(testTitleCriteria("it('UTF-8 handling')\nit('ADR-0003: x')"), [], 'only acceptance-criteria IDs');
});

test('weakened checks are found in a diff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,0 +11,2 @@',
    '+  // @ts-ignore',
    '+  const x = y as any; // eslint-disable-line no-explicit-any',
    '@@ -20 +22 @@',
    '-  // eslint-disable-next-line',
    '+  return x;',
    'diff --git a/src/a.spec.ts b/src/a.spec.ts',
    '--- a/src/a.spec.ts',
    '+++ b/src/a.spec.ts',
    '@@ -3,3 +3,2 @@',
    "-it('A-1: works', () => {",
    "+it.skip('A-1: works', () => {",
    '-  expect(a).toBe(1);',
    "@@ -9 +8 @@",
    "-describe('group', () => {",
    "+describe.skip('group', () => {",
    'diff --git a/src/b.spec.ts b/src/b.spec.ts',
    'deleted file mode 100644',
    '--- a/src/b.spec.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    "-it('B-1: x', () => { expect(1).toBe(1); });",
    'diff --git a/src/c.spec.ts b/src/c.spec.ts',
    '--- a/src/c.spec.ts',
    '+++ b/src/c.spec.ts',
    '@@ -1 +1 @@',
    '-  expect(c).toBe(1);',
    '+  expect(c).toBe(1); ',
    'diff --git a/vitest.config.ts b/vitest.config.ts',
    '--- a/vitest.config.ts',
    '+++ b/vitest.config.ts',
    '@@ -5,2 +5,2 @@',
    '-      lines: 80,',
    '-      branches: 70,',
    '+      lines: 60,',
    '+      branches: 75,',
  ].join('\n');
  const isTest = (f) => f.endsWith('.spec.ts');
  assert.deepEqual(weakenedChecks(diff, isTest), [
    { kind: 'suppression', file: 'src/a.ts', line: 11, text: '// @ts-ignore' },
    { kind: 'suppression', file: 'src/a.ts', line: 12, text: 'const x = y as any; // eslint-disable-line no-explicit-any' },
    { kind: 'skipped-test', file: 'src/a.spec.ts', line: 3, text: "it.skip('A-1: works', () => {" },
    { kind: 'skipped-test', file: 'src/a.spec.ts', line: 8, text: "describe.skip('group', () => {" },
    { kind: 'removed-assertions', file: 'src/a.spec.ts', line: null, text: '1 fewer assertion' },
    { kind: 'deleted-test', file: 'src/b.spec.ts', line: null, text: 'test file deleted' },
    { kind: 'lowered-threshold', file: 'vitest.config.ts', line: 5, text: 'lines: 80 → 60' },
  ]);
  assert.deepEqual(weakenedChecks('', isTest), []);
  const withContext = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n const b = 2;\n+// @ts-expect-error\n';
  assert.deepEqual(weakenedChecks(withContext, isTest).map((w) => w.line), [3], 'context lines count towards line numbers');
});

test('weakened checks feed the blast radius in bounded PRs and get their own section in planned ones', () => {
  const args = { issue: null, commits: [{ subject: 'fix: x' }], files: [], tests: [], sections: explanationSections(['Blast radius: low.']), refs: [], fixesRef: null };
  assert.doesNotMatch(fixPrBody(args), /Checks weakened|weakens/);
  const weakened = [{ kind: 'suppression', file: 'src/a.ts', line: 11, text: '// @ts-ignore' }, { kind: 'deleted-test', file: 'src/b.spec.ts', line: null, text: 'test file deleted' }];
  assert.match(fixPrBody({ ...args, weakened }), /\*\*Blast radius:\*\* low\.\n\nChecks this change weakens:\n\n- suppression: `src\/a\.ts:11` `\/\/ @ts-ignore`\n- deleted test: `src\/b\.spec\.ts` test file deleted/);
  const feature = { goal: 'g', specRel: 's', trackingRef: null, tasks: '- t', files: [], tests: [], criteria: '- c', rulings: [], reviewFocus: '', footers: 'Plan: 000001' };
  assert.doesNotMatch(featurePrBody(feature), /Checks weakened/);
  assert.match(featurePrBody({ ...feature, weakened }), /## Checks weakened\n\n- suppression[\s\S]*\n\nPlan: 000001$/);
});

test('commit bodies state the door and the blast radius; Risk: still reads as the blast radius', () => {
  const s = explanationSections(['Fix: drop the column.\nDoor: one-way — the column is dropped.\nBlast radius: clients reading `title`.']);
  assert.equal(s.door, 'one-way — the column is dropped.');
  assert.equal(s.blast, 'clients reading `title`.');
  assert.equal(explanationSections(['Risk: none; valid buckets behave as before.']).blast, 'none; valid buckets behave as before.');
});

test('one-way signs come from migrations, SQL and code a contract this repository provides cites', () => {
  const files = [{ status: 'A', path: 'prisma/migrations/20261111_drop/migration.sql' }, { status: 'M', path: 'db/seed.sql' },
    { status: 'M', path: 'src/billing/billing.service.ts' }, { status: 'M', path: 'src/web/client.ts' }, { status: 'M', path: 'src/other.ts' }];
  const contracts = [
    { rel: 'docs/contracts/billing-api.md', text: '---\nprovider: api\nconsumers: [web]\n---\nIssued by `repos/api/src/billing/billing.service.ts::BillingService`, shown by `repos/web/x.tsx`.\n' },
    { rel: 'docs/contracts/web-events.md', text: '---\nprovider: web\nconsumers: [api]\n---\nConsumed by `repos/api/src/web/client.ts`.\n' },
  ];
  assert.deepEqual(oneWaySigns(files, 'api', contracts), [
    { path: 'prisma/migrations/20261111_drop/migration.sql', why: 'migration' },
    { path: 'db/seed.sql', why: 'SQL' },
    { path: 'src/billing/billing.service.ts', why: 'contract `docs/contracts/billing-api.md`' },
  ]);
  assert.deepEqual(oneWaySigns([{ status: 'M', path: 'src/other.ts' }], 'api', contracts), []);
});

test('the PR states its merge danger: written door first, then inferred one-way, else not stated', () => {
  const base = { issue: null, commits: [{ subject: 'fix: x' }], files: [], tests: [], refs: [], fixesRef: null };
  const signs = [{ path: 'prisma/migrations/1/migration.sql', why: 'migration' }];
  const pr = (bodies, oneWay = []) => fixPrBody({ ...base, sections: explanationSections(bodies), oneWay });
  const danger = (body) => body.slice(body.indexOf('## Merge danger'));
  assert.doesNotMatch(pr(['Fix: y.']), /## Risk/);
  assert.match(danger(pr(['Fix: y.'])), /^## Merge danger\n\n\*\*Door:\*\* 🤔 not stated\n\n\*\*Blast radius:\*\* not stated$/);
  assert.match(pr(['Door: one-way — drops a column.\nBlast radius: title readers.']), /\*\*Door:\*\* ⛔ one-way — drops a column\.\n\n\*\*Blast radius:\*\* title readers\./);
  assert.match(pr(['Door: two-way; a revert restores it.']), /\*\*Door:\*\* 🔄 two-way; a revert restores it\.\n\n\*\*Blast/);
  assert.match(pr(['Fix: y.'], signs), /\*\*Door:\*\* ⛔ one-way \(inferred from the diff\)\n\n- `prisma\/migrations\/1\/migration\.sql` \(migration\)\n\n\*\*Blast/);
  assert.match(pr(['Door: two-way, the migration only adds a nullable column.'], signs),
    /\*\*Door:\*\* 🔄 two-way, the migration only adds a nullable column\. \(author\)\n\nThe diff touches files that usually mean one-way:\n\n- `prisma\/migrations\/1\/migration\.sql` \(migration\)/);
  assert.match(pr(['Door: two-way.', 'Door: one-way — sends emails.']), /\*\*Door:\*\* ⛔ two-way\.\n\none-way — sends emails\./, 'any one-way commit makes the PR one-way');
  assert.match(pr(['Door: probably fine.']), /\*\*Door:\*\* 🤔 probably fine\./, 'a door that names neither way is not stated');
});

test('frontmatter parsing and editing', () => {
  const doc = '---\ntype: architecture-area\npaths:\n  - repos/api/src/billing/**\n  - "repos/api/src/invoices/**"\n---\n# Billing\n';
  const fm = splitFrontmatter(doc);
  assert.equal(fm.error, null);
  assert.deepEqual(fm.data, { type: 'architecture-area', paths: ['repos/api/src/billing/**', 'repos/api/src/invoices/**'] });
  assert.equal(splitFrontmatter('# none').has, false);
  assert.match(setFrontmatterValue('---\ntype: design\nstatus: approved\n---\n', 'status', 'done'), /status: done/);
});

test('code is ignored when scanning prose', () => {
  const doc = 'Use `TBD` here\n```\n[x](missing.md) TODO\n```\n[ok](./a.md) and ![img](b.png)\n';
  assert.ok(!/TBD|TODO/.test(stripCode(doc)));
  assert.deepEqual(links(doc), [{ target: './a.md', line: 5 }]);
  assert.deepEqual(codeSpans('see `repos/api/src/a.ts::A`\n```\n`not this`\n```').map((s) => s.code), ['repos/api/src/a.ts::A']);
});

test('sections end at the next heading of the same level', () => {
  const doc = '# T\n## Evolution\n- [a](a.md)\n### Sub\nx\n## Next\ny\n';
  assert.match(section(doc, 'Evolution').text, /a\.md[\s\S]*Sub[\s\S]*x/);
  assert.doesNotMatch(section(doc, 'Evolution').text, /Next/);
});

test('globs', () => {
  assert.ok(globToRegExp('**/*.module.ts').test('billing.module.ts'));
  assert.ok(globToRegExp('**/*.module.ts').test('apps/api/src/billing/billing.module.ts'));
  assert.ok(globToRegExp('**/app/*/layout.tsx').test('apps/web/app/(shop)/layout.tsx'));
  assert.ok(!globToRegExp('**/app/*/layout.tsx').test('app/(shop)/cart/layout.tsx'));
  assert.ok(matchesAny('infra/db.ts', ['**/infra/**/*.ts']));
});

const PLAN = `# Checkout Implementation Plan

**Spec:** [design](../specs/000042-checkout-design.md)

**Repo:** \`repos/api\`

**Branch:** \`feat/000042-checkout\`

---

### Task 1: Charge endpoint

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Implement**

### Task 2: Receipt

- [ ] **Step 1: Write the failing test**

## Execution rules

- [ ] not a task checkbox
`;

test('plans: Blocked by lines are read per task and survive ticking', () => {
  const plan = PLAN
    .replace('### Task 1: Charge endpoint\n', '### Task 1: Charge endpoint\n\n**Blocked by:** None\n')
    .replace('### Task 2: Receipt\n', '### Task 2: Receipt\n\n**Blocked by:** Task 1\n');
  const p = parsePlan(plan);
  assert.deepEqual(p.tasks.map((t) => t.blockedBy && t.blockedBy.value), ['None', 'Task 1']);
  assert.deepEqual(p.tasks.map((t) => t.checkboxes.length), [2, 1], 'the line is not a step');
  const ticked = tickTasks(plan, new Set([1, 2]));
  assert.match(ticked, /### Task 2: Receipt\n\n\*\*Blocked by:\*\* Task 1\n/, 'ticking leaves the line as written');
  assert.ok(parsePlan(ticked).tasks.every((t) => t.checkboxes.every((c) => c.checked)));
});

test('plans: a task waits only for earlier tasks of its plan', () => {
  const task = (number, value) => ({ number, line: 1, blockedBy: value === undefined ? null : { line: 2, value } });
  assert.equal(blockedByError(task(1, 'None')), null);
  assert.equal(blockedByError(task(3, 'Task 1, Task 2')), null);
  assert.match(blockedByError(task(2)), /Task 2 has no "\*\*Blocked by:\*\*" line/);
  assert.match(blockedByError(task(2, '')), /"None" or a list like "Task 1, Task 3"/);
  assert.match(blockedByError(task(2, 'the API task')), /"None" or a list like "Task 1, Task 3"/);
  assert.match(blockedByError(task(2, 'Task 1 and Task 3')), /"None" or a list like/);
  assert.match(blockedByError(task(2, 'Task 2')), /Task 2 is blocked by Task 2; a task waits only for earlier tasks/);
  assert.match(blockedByError(task(2, 'Task 1, Task 4')), /Task 2 is blocked by Task 4; a task waits only for earlier tasks/);
});

test('plans: parse, tick, completion', () => {
  const p = parsePlan(PLAN);
  assert.equal(p.spec, '../specs/000042-checkout-design.md');
  assert.equal(p.repoPath, 'repos/api');
  assert.equal(p.branch, 'feat/000042-checkout');
  assert.deepEqual(p.tasks.map((t) => [t.number, t.checkboxes.length]), [[1, 2], [2, 1]]);
  const ticked = tickTasks(PLAN, new Set([1]));
  assert.deepEqual(parsePlan(ticked).tasks.map((t) => t.checkboxes.every((c) => c.checked)), [true, false]);
  assert.match(ticked, /- \[ \] not a task checkbox/);
  const done = `${PLAN}\n## Completion\n\n**Merged:** \`repos/api@abcdef123456\` feat: x\n\n### Rulings\n\n- None.\n\n### Deferred\n\n- Task 2: Receipt\n`;
  const pd = parsePlan(done);
  assert.deepEqual([...pd.deferred], [2]);
  assert.deepEqual(pd.merged, [{ path: 'repos/api', sha: 'abcdef123456' }]);
  assert.ok(pd.completion.hasRulings);
  assert.deepEqual(rulingsFromLedger('# progress\n- Ruling: kept Stripe SDK v14 — v15 breaks webhooks — rework if upgraded\nTask 1 done'), [
    'Ruling: kept Stripe SDK v14 — v15 breaks webhooks — rework if upgraded',
  ]);
  // Parked review findings carry their ruling inside the line; older Superpowers wrote it lower-case.
  assert.deepEqual(rulingsFromLedger('Task 2: parked — reviewer wants a cache — Ruling: one call per request\nTask 3: parked — x — ruling: y\nTask 2: complete'), [
    'Task 2: parked — reviewer wants a cache — Ruling: one call per request',
    'Task 3: parked — x — ruling: y',
  ]);
});

test('criteria move from a spec into feature documents by ID', () => {
  const spec = '# S\n\n## Acceptance criteria\n\n- **PAY-1** new text\n- **PAY-3** added\n  - Given a\n  - Then b\n\n## Links\n\n- Feature: [Pay](../../features/pay.md)\n';
  const groups = criteriaByFeature(spec);
  assert.deepEqual([...groups.keys()], ['../../features/pay.md']);
  const feature = '---\ntype: feature\n---\n# Pay\n\n## Acceptance criteria\n\n- **PAY-1** old text\n- **PAY-2** kept\n\n## Out of scope\n\n- refunds\n';
  const merged = mergeCriteria(feature, groups.get('../../features/pay.md'));
  assert.deepEqual(criteriaBlocks(merged).map((b) => b.id), ['PAY-1', 'PAY-2', 'PAY-3']);
  assert.match(merged, /PAY-1\*\* new text/);
  assert.match(merged, /  - Then b\n\n## Out of scope/);
  assert.match(mergeCriteria(newFeatureDoc('Pay'), groups.get('../../features/pay.md')), /# Pay\n\n## Acceptance criteria\n\n- \*\*PAY-1/);
  assert.throws(() => criteriaByFeature('# S\n\n## Acceptance criteria\n\n- **PAY-1** x\n'), /Feature:/);
  const grouped = '## Acceptance criteria\n\n### [Pay](../../features/pay.md)\n\n- **PAY-4** a\n\n### [Wallet](../../features/wallet.md)\n\n- **WALLET-1** b\n';
  assert.deepEqual([...criteriaByFeature(grouped).keys()], ['../../features/pay.md', '../../features/wallet.md']);
  const fresh = '## Acceptance criteria\n\n- **NEW-1** a\n\n## Links\n\n- Feature: `docs/features/new-thing.md` (new)\n';
  assert.deepEqual([...criteriaByFeature(fresh).keys()], ['docs/features/new-thing.md']);
});

test('commit bodies become PR sections', () => {
  const s = explanationSections(['Cause: totals used floor.\nFix: round half-up.\n\nVerification: added a 10.005 case.\n\nSome extra note.']);
  assert.equal(s.cause, 'totals used floor.');
  assert.equal(s.fix, 'round half-up.');
  assert.equal(s.verification, 'added a 10.005 case.');
  assert.equal(s.other, 'Some extra note.');
  const body = fixPrBody({ issue: { ref: 'acme/hub#3', title: 'Totals off' }, commits: [{ subject: 'fix(billing): round totals' }], files: [{ status: 'M', path: 'src/a.ts' }],
    tests: ['src/a.spec.ts'], sections: s, refs: ['BILL-1'], fixesRef: 'acme/hub#3' });
  assert.match(body, /^## Context\n\nReported in acme\/hub#3: \*\*Totals off\*\*\.\n\n## Root cause\n\ntotals used floor\.\n\n## What changed\n\nround half-up\./);
  assert.match(body, /## How it was verified\n\nadded a 10\.005 case\.\n\nTests added or changed:\n\n- `src\/a\.spec\.ts`/);
  assert.match(body, /\n\nFixes acme\/hub#3\nRefs: BILL-1$/);
});

test('specs can retire criteria; retired criteria are not definitions', () => {
  const ac = '\n- **PAY-5** new behaviour\n\n### Removed\n\n- **PAY-2** Archiving replaces deletion.\n';
  const split = splitCriteria(ac);
  assert.deepEqual(split.added.map((b) => b.id), ['PAY-5']);
  assert.deepEqual(split.removed.map((b) => b.id), ['PAY-2']);
  const spec = `# S\n\n## Acceptance criteria\n${ac}\n## Links\n\n- Feature: [Pay](../../features/pay.md)\n`;
  assert.deepEqual(criteriaByFeature(spec).get('../../features/pay.md').map((b) => b.id), ['PAY-5'], 'retired criteria are not moved in');
  const feature = '---\ntype: feature\n---\n# Pay\n\n## Acceptance criteria\n\n- **PAY-1** keep\n- **PAY-2** goes\n  - Given old flow\n- **PAY-3** keep\n';
  const r = removeCriteria(feature, ['PAY-2']);
  assert.deepEqual(r.removed, ['PAY-2']);
  assert.deepEqual(criteriaBlocks(r.text).map((b) => b.id), ['PAY-1', 'PAY-3']);
  const root = mkdtempSync(join(tmpdir(), 'hub-ac-'));
  mkdirSync(join(root, 'docs/features'), { recursive: true });
  mkdirSync(join(root, 'docs/superpowers/specs'), { recursive: true });
  writeFileSync(join(root, 'docs/superpowers/specs/000001-x-design.md'), spec);
  const defs = loadAcDefinitions(root);
  assert.ok(defs.has('PAY-5'));
  assert.ok(!defs.has('PAY-2'), 'a test still citing a retired criterion fails pnpm check');
});

const GLOSSARY = `# Glossary

What the hub's words mean.

\`\`\`markdown
### Not a term
\`\`\`

## Hub

The hub's own vocabulary.

### Ruling
A decision the executing agent makes where the plan is wrong. It is recorded as a \`Ruling:\` footer.
_Avoid_: deviation, override.

### Door

Whether reverting the squash undoes a change.
`;

test('glossary: a well-formed glossary has no problems', () => {
  assert.deepEqual(glossaryProblems(GLOSSARY), []);
});

test('glossary: each broken rule is reported once, at its line', () => {
  const cases = [
    ['a term outside a context', (t) => t.replace('## Hub\n', '### Orphan\nA stray term.\n\n## Hub\n'), /not under a "## " context/],
    ['a heading deeper than a term', (t) => `${t}\n#### Detail\n`, /deeper than ###/],
    ['a term with no definition', (t) => `${t}\n### Frontier\n`, /"Frontier" has no definition/],
    ['three sentences', (t) => t.replace('a `Ruling:` footer.', 'a `Ruling:` footer. It is kept.'), /3 sentences; the limit is two/],
    ['a list under a term', (t) => t.replace('_Avoid_: deviation', '- a list item\n_Avoid_: deviation'), /"Ruling": only one definition paragraph/],
    ['a second paragraph', (t) => t.replace('undoes a change.\n', 'undoes a change.\n\nMore prose.\n'), /"Door": only one definition paragraph/],
    ['a duplicate term', (t) => `${t}\n### ruling\nAgain.\n`, /"ruling" is defined twice/],
    ['an avoided word that is a term', (t) => t.replace('override.', 'door.'), /"door" is listed under _Avoid_ but is a term/],
    ['an email address', (t) => t.replace('What the hub', 'Ask someone@example.com what the hub'), /email address/],
    ['an @-mention', (t) => t.replace('What the hub', 'Ask @someone what the hub'), /@-mention/],
  ];
  for (const [name, mutate, message] of cases) {
    const problems = glossaryProblems(mutate(GLOSSARY));
    assert.equal(problems.length, 1, `${name}: ${JSON.stringify(problems)}`);
    assert.match(problems[0].message, message, name);
    assert.ok(problems[0].line >= 1, name);
  }
});
