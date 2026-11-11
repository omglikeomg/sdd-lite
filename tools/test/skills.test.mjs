// The hub's skills: structure, trigger prompts and description collisions, checked without a model.
// The first part tests the checks on small fixture skills; the last part runs them on
// .claude/skills and tools/evals/triggers/. Cases naming a Superpowers skill skip when Superpowers
// is not installed (CI has none).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkills, structureProblems, buildIndex, triggerProblems, collisions } from '../lib/skills.mjs';
import { findSuperpowers } from '../lib/compat.mjs';
import { assembleEvalPlugin, evalArgs } from '../skill-eval.mjs';

const base = mkdtempSync(join(tmpdir(), 'hub-skills-'));
after(() => rmSync(base, { recursive: true, force: true }));

const GOOD_BODY = `# Example

## Overview

Does the example thing.

## When NOT to use

- Something else: use \`other\`.

## Red flags

| Thought | Reality |
|---|---|
| "Skip it" | Do not. |

## Verification

- [ ] The example ran — **Evidence:** its output line pasted in the conversation.
`;

function skillText({ name = 'example', description = 'Use when an example is needed - drafts the example', body = GOOD_BODY } = {}) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

function writeSkill(root, dir, text) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'SKILL.md'), text);
}

function oneSkill(text, dir = 'example') {
  const root = mkdtempSync(join(base, 'one-'));
  writeSkill(root, dir, text);
  return loadSkills(root)[0];
}

test('structure: a well-formed skill has no problems', () => {
  assert.deepEqual(structureProblems(oneSkill(skillText())), []);
});

test('structure: the name must match the folder', () => {
  assert.deepEqual(structureProblems(oneSkill(skillText({ name: 'other' }))), ['name "other" does not match its folder "example"']);
});

test('structure: the description starts with "Use when"', () => {
  const problems = structureProblems(oneSkill(skillText({ description: 'Drafts the example - when needed' })));
  assert.deepEqual(problems, ['description must start with "Use when"']);
});

test('structure: the description ends with exactly one " - " what clause', () => {
  assert.deepEqual(structureProblems(oneSkill(skillText({ description: 'Use when an example is needed' }))), [
    'description needs one " - " followed by a short clause saying what the skill does',
  ]);
  assert.deepEqual(structureProblems(oneSkill(skillText({ description: 'Use when a - b - drafts it' }))), [
    'description needs one " - " followed by a short clause saying what the skill does',
  ]);
});

test('structure: the what clause names no steps', () => {
  for (const what of ['asks questions, then writes the doc', 'asks questions before writing the doc', 'asks; writes', 'first asks questions']) {
    assert.deepEqual(structureProblems(oneSkill(skillText({ description: `Use when needed - ${what}` }))), [
      'the what clause summarises steps ("then", "before", "after", "first" or ";"); say what the skill does, not how',
    ], what);
  }
  assert.deepEqual(structureProblems(oneSkill(skillText({ description: `Use when needed - ${'x'.repeat(201)}` }))), [
    'the what clause is 201 characters; keep it to 200',
  ]);
});

test('structure: the description fits in 1024 characters', () => {
  const problems = structureProblems(oneSkill(skillText({ description: `Use when ${'a '.repeat(510)}- drafts it` })));
  assert.deepEqual(problems, ['description is 1040 characters; the limit is 1024']);
});

test('structure: every required section is present', () => {
  for (const title of ['Overview', 'When NOT to use', 'Red flags', 'Verification']) {
    const body = GOOD_BODY.replace(`## ${title}\n`, '## Something else\n');
    assert.deepEqual(structureProblems(oneSkill(skillText({ body }))), [`missing section "## ${title}"`], title);
  }
});

test('structure: every Verification item names its evidence', () => {
  const empty = GOOD_BODY.replace('- [ ] The example ran — **Evidence:** its output line pasted in the conversation.', 'Check it.');
  assert.deepEqual(structureProblems(oneSkill(skillText({ body: empty }))), ['Verification has no checklist items']);
  const bare = GOOD_BODY.replace(' — **Evidence:** its output line pasted in the conversation.', '');
  assert.deepEqual(structureProblems(oneSkill(skillText({ body: bare }))), [
    'Verification item names no evidence ("— **Evidence:** …"): "The example ran"',
  ]);
  const vague = `${GOOD_BODY}- [ ] It looks right\n`;
  assert.deepEqual(structureProblems(oneSkill(skillText({ body: vague }))), [
    'Verification item names no evidence ("— **Evidence:** …"): "It looks right"',
  ]);
});

test('structure: a skill stays under 500 lines', () => {
  const body = `${GOOD_BODY}${'filler\n'.repeat(500)}`;
  const [problem] = structureProblems(oneSkill(skillText({ body })));
  assert.match(problem, /^SKILL\.md has 5\d\d lines; keep it under 500$/);
});

const CATALOG = [
  { name: 'invoice-writer', description: 'Use when someone needs an invoice issued or corrected for a customer - drafts the invoice' },
  { name: 'refund-handler', description: 'Use when a customer asks for money back on a payment - prepares the refund' },
  { name: 'superpowers:brainstorming', description: 'Use before any creative work - explores intent and design' },
];

test('triggers: a prompt ranks the skill sharing its rarest words first', () => {
  const index = buildIndex(CATALOG);
  assert.equal(index.rank('please issue an invoice for this customer')[0].name, 'invoice-writer');
  assert.equal(index.rank('the customer wants their money back')[0].name, 'refund-handler');
});

const cases = (positive, negative) => ({ positive, negative });
const POSITIVES = ['please issue an invoice', 'correct the invoice for ACME', 'invoice the customer'];
const NEGATIVES = [
  { prompt: 'the customer wants their money back', owner: 'refund-handler' },
  { prompt: 'let us brainstorm a creative design', owner: 'superpowers:brainstorming' },
];

test('triggers: a complete, passing case file has no problems', () => {
  assert.deepEqual(triggerProblems('invoice-writer', cases(POSITIVES, NEGATIVES), buildIndex(CATALOG)), { problems: [], skipped: [] });
});

test('triggers: a prompt that should fire the skill but ranks another first is reported', () => {
  const { problems } = triggerProblems('invoice-writer', cases([...POSITIVES, 'give the customer their money back'], NEGATIVES), buildIndex(CATALOG));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^should fire invoice-writer but ranks #2: "give the customer their money back" \(#1: refund-handler/);
});

test('triggers: a prompt that should stay quiet must be outranked by its owner', () => {
  const negatives = [...NEGATIVES, { prompt: 'issue the invoice now', owner: 'refund-handler' }];
  const { problems } = triggerProblems('invoice-writer', cases(POSITIVES, negatives), buildIndex(CATALOG));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^should stay quiet for invoice-writer but its owner refund-handler does not outrank it: "issue the invoice now"/);
});

test('triggers: an owner from Superpowers skips when Superpowers is not installed; an unknown hub owner fails', () => {
  const hubOnly = buildIndex(CATALOG.filter((s) => !s.name.startsWith('superpowers:')));
  assert.deepEqual(triggerProblems('invoice-writer', cases(POSITIVES, NEGATIVES), hubOnly), {
    problems: [],
    skipped: ['"let us brainstorm a creative design" (superpowers:brainstorming is not installed)'],
  });
  const { problems } = triggerProblems('invoice-writer', cases(POSITIVES, [...NEGATIVES, { prompt: 'x', owner: 'ghost' }]), hubOnly);
  assert.deepEqual(problems, ['owner "ghost" of "x" is not a known skill']);
});

test('triggers: a case file needs three prompts that fire and two that stay quiet', () => {
  const { problems } = triggerProblems('invoice-writer', cases(POSITIVES.slice(0, 2), NEGATIVES.slice(0, 1)), buildIndex(CATALOG));
  assert.deepEqual(problems, ['needs at least 3 prompts that should fire it (has 2)', 'needs at least 2 prompts that should stay quiet (has 1)']);
});

test('collisions: two near-identical descriptions are reported, Superpowers pairs among themselves are not', () => {
  const twin = { name: 'invoice-fixer', description: 'Use when someone needs an invoice issued or corrected for a customer - fixes the invoice' };
  const spTwin = { name: 'superpowers:ideation', description: 'Use before any creative work - explores intent and design' };
  const found = collisions(buildIndex([...CATALOG, twin, spTwin]), 0.6);
  assert.deepEqual(found.map((c) => [c.a, c.b]), [['invoice-fixer', 'invoice-writer']]);
  assert.ok(found[0].score > 0.6);
});

// ---- The hub's own skills ----

const HUB = new URL('../..', import.meta.url).pathname;
const TRIGGERS = join(HUB, 'tools/evals/triggers');
const hubSkills = loadSkills(join(HUB, '.claude/skills'));
const sp = findSuperpowers();
const spSkills = sp ? loadSkills(join(sp.dir, 'skills'), 'superpowers:') : [];
const index = buildIndex([...hubSkills, ...spSkills]);
// The most alike pair when this check was introduced (onboard-repository ~ review-pull-request) measured 0.28.
// A description edit that pushes a pair past the limit makes two skills compete for the same prompts.
const COLLISION_LIMIT = 0.35;

test('hub skills: every skill has the required structure', () => {
  const problems = hubSkills.flatMap((s) => structureProblems(s).map((p) => `${s.folder}: ${p}`));
  assert.deepEqual(problems, []);
});

test('hub skills: every skill has a trigger file, and every trigger file a skill', () => {
  const files = existsSync(TRIGGERS) ? readdirSync(TRIGGERS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  assert.deepEqual(hubSkills.map((s) => s.folder).filter((n) => !files.includes(n)), [], 'skills without tools/evals/triggers/<skill>.json');
  assert.deepEqual(files.filter((f) => !hubSkills.some((s) => s.folder === f)), [], 'trigger files without a skill');
});

for (const skill of hubSkills) {
  const file = join(TRIGGERS, `${skill.folder}.json`);
  test(`hub skills: ${skill.folder} fires on its prompts and stays quiet on its neighbours'`, { skip: existsSync(file) ? false : 'no trigger file' }, (t) => {
    const { problems, skipped } = triggerProblems(skill.name, JSON.parse(readFileSync(file, 'utf8')), index);
    for (const s of skipped) t.diagnostic(`skipped ${s}`);
    assert.deepEqual(problems, []);
  });
}

test(`hub skills: no two descriptions are ${COLLISION_LIMIT} alike or more`, (t) => {
  if (!sp) t.diagnostic('Superpowers not found: compared hub skills with each other only');
  assert.deepEqual(collisions(index, COLLISION_LIMIT).map((c) => `${c.a} ~ ${c.b}: ${c.score.toFixed(2)}`), []);
});

// ---- pnpm skills:eval ----

test('skills:eval assembles a plugin of plain copies: manifest, skills and cases', () => {
  const hub = mkdtempSync(join(base, 'hub-'));
  writeSkill(join(hub, '.claude/skills'), 'example', skillText());
  writeFileSync(join(hub, '.claude/skills/example/notes.md'), 'notes\n');
  mkdirSync(join(hub, 'tools/evals/cases/example-fires/graders'), { recursive: true });
  writeFileSync(join(hub, 'tools/evals/cases/example-fires/prompt.md'), '---\nname: example-fires\n---\nDo it.\n');
  writeFileSync(join(hub, 'tools/evals/cases/example-fires/graders/fired.md'), '---\ntype: tool_used\ntool: Skill\n---\n');
  const dest = join(base, 'plugin');
  assembleEvalPlugin(hub, dest);
  assert.deepEqual(JSON.parse(readFileSync(join(dest, '.claude-plugin/plugin.json'), 'utf8')), { name: 'hub-skills', experimental: { evals: 'cases' } });
  assert.equal(readFileSync(join(dest, 'skills/example/notes.md'), 'utf8'), 'notes\n');
  assert.ok(!lstatSync(join(dest, 'skills')).isSymbolicLink(), 'claude plugin eval rejects linked folders');
  assert.ok(existsSync(join(dest, 'cases/example-fires/graders/fired.md')));
});

test('skills:eval keeps reports out of git and never publishes unless asked', () => {
  const args = evalArgs('/plugin', '/hub', ['--case', 'review-*'], '2026-11-11T12-00-00');
  assert.deepEqual(args, [
    'plugin', 'eval', '/plugin', '--no-publish',
    '--report', '/hub/.skill-evals/2026-11-11T12-00-00/report.html',
    '--json', '/hub/.skill-evals/2026-11-11T12-00-00/result.json',
    '--case', 'review-*',
  ]);
  assert.ok(!evalArgs('/plugin', '/hub', ['--publish-report'], 't').includes('--no-publish'));
});
