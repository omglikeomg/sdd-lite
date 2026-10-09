import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlanBranch, branchNameError, commitHeaderError, cleanMessage, footerValues, taskNumbers, isAcId,
  parseSpecFilename, parsePlanFilename, TEST_TITLE_AC_RE, adrLabel,
} from '../lib/conventions.mjs';
import { splitFrontmatter, setFrontmatterValue, stripCode, codeSpans, links, section } from '../lib/markdown.mjs';
import { globToRegExp, matchesAny } from '../lib/glob.mjs';
import { parsePlan, tickTasks, rulingsFromLedger } from '../lib/plans.mjs';
import { criteriaBlocks, criteriaByFeature, mergeCriteria, newFeatureDoc, splitCriteria, removeCriteria } from '../lib/features.mjs';
import { loadAcDefinitions } from '../lib/hub.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explanationSections, fixPrBody } from '../lib/pr-text.mjs';

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
  // Subagent-driven development writes parked review findings with a lower-case "ruling:".
  assert.deepEqual(rulingsFromLedger('Task 2: parked — reviewer wants a cache — ruling: one call per request, no cache needed\nTask 2: complete'), [
    'Task 2: parked — reviewer wants a cache — ruling: one call per request, no cache needed',
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
