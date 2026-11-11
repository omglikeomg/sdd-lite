// What the hub writes in product-repository pull requests. Reviewers read top to bottom: why the
// change exists, what changed, why it is right, how we know it works, how dangerous it is to merge.
// Footers stay last, because the squash commit keeps them.
import { splitFrontmatter, codeSpans } from './markdown.mjs';
import { matchesAny } from './glob.mjs';

// `Risk:` predates the door and blast radius; it still reads as the blast radius.
const LABELS = { Context: 'context', Cause: 'cause', Rationale: 'rationale', Fix: 'fix', Change: 'fix', Verification: 'verification', Door: 'door', 'Blast radius': 'blast', Risk: 'blast' };

// Split commit-body prose into the labelled paragraphs bounded work uses (`Cause: …`, `Fix: …`);
// unlabelled paragraphs are kept in `other`.
export function explanationSections(bodies) {
  const sections = { context: [], cause: [], rationale: [], fix: [], verification: [], door: [], blast: [], other: [] };
  const LABEL_LINE = /^(Context|Cause|Rationale|Fix|Change|Verification|Door|Blast radius|Risk):\s*(.*)$/;
  for (const body of bodies) {
    // A block ends at a blank line or where the next labelled line starts.
    let current = null;
    const flush = () => {
      if (current && current.text.trim()) sections[current.key].push(current.text.trim());
      current = null;
    };
    for (const line of body.split('\n')) {
      const m = LABEL_LINE.exec(line);
      if (m) {
        flush();
        current = { key: LABELS[m[1]], text: m[2] };
      } else if (!line.trim()) {
        flush();
      } else if (current) current.text += `\n${line}`;
      else current = { key: 'other', text: line };
    }
    flush();
  }
  return Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.join('\n\n')]));
}

const STATUS_WORD = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };
function fileList(files) {
  if (!files.length) return '';
  const lines = files.map((f) => `- \`${f.path}\` (${STATUS_WORD[f.status[0]] || f.status})`).join('\n');
  return files.length > 8 ? `<details><summary>${files.length} files</summary>\n\n${lines}\n\n</details>` : lines;
}

function verification(tests, extra) {
  const parts = [];
  if (extra) parts.push(extra);
  if (tests.length) parts.push(`Tests added or changed:\n\n${tests.map((t) => `- \`${t}\``).join('\n')}`);
  return parts.join('\n\n') || 'No tests were added or changed; say how this was verified.';
}

// Checks a change weakens (`weakenedChecks` in floor.mjs), one line each; empty when there are none.
const WEAKENED_LABEL = { suppression: 'suppression', 'skipped-test': 'skipped test', 'deleted-test': 'deleted test', 'removed-assertions': 'removed assertions', 'lowered-threshold': 'lowered threshold' };
export function weakenedList(weakened = []) {
  return weakened.map((w) => `- ${WEAKENED_LABEL[w.kind]}: \`${w.file}${w.line ? `:${w.line}` : ''}\` ${w.line ? `\`${w.text}\`` : w.text}`).join('\n');
}

// Changed files that usually make a change one-way: migrations, SQL, and code that a contract this
// repository provides cites. Paths can show these; they cannot show external side effects.
const MIGRATION_GLOBS = ['**/migrations/**'];
export function oneWaySigns(files, repoName, contracts) {
  const prefix = `repos/${repoName}/`;
  const cited = new Map();
  for (const c of contracts) {
    if (splitFrontmatter(c.text).data.provider !== repoName) continue;
    for (const { code } of codeSpans(c.text)) {
      const path = code.split('::')[0];
      if (path.startsWith(prefix) && !cited.has(path.slice(prefix.length))) cited.set(path.slice(prefix.length), c.rel);
    }
  }
  return files.flatMap(({ path }) => {
    if (matchesAny(path, MIGRATION_GLOBS)) return [{ path, why: 'migration' }];
    if (path.endsWith('.sql')) return [{ path, why: 'SQL' }];
    if (cited.has(path)) return [{ path, why: `contract \`${cited.get(path)}\`` }];
    return [];
  });
}

// Door: what the commits say wins (one-way if any says so), then one-way inferred from the diff,
// else not stated. A written two-way that contradicts the diff keeps the evidence next to it.
const DOOR_WAY = /^(one|two)[- ]way\b/i;
function mergeDanger(sections, oneWay = [], weakened = []) {
  const signList = oneWay.map((s) => `- \`${s.path}\` (${s.why})`).join('\n');
  const ways = sections.door ? sections.door.split('\n\n').map((p) => DOOR_WAY.exec(p)?.[1].toLowerCase()) : [];
  let door;
  if (ways.includes('one')) door = `⛔ ${sections.door}`;
  else if (ways.length && ways.every((w) => w === 'two')) {
    door = `🔄 ${sections.door}`;
    if (oneWay.length) door += ` (author)\n\nThe diff touches files that usually mean one-way:\n\n${signList}`;
  } else if (sections.door) door = `🤔 ${sections.door}${oneWay.length ? `\n\nThe diff touches files that usually mean one-way:\n\n${signList}` : ''}`;
  else door = oneWay.length ? `⛔ one-way (inferred from the diff)\n\n${signList}` : '🤔 not stated';
  const out = ['## Merge danger', '', `**Door:** ${door}`, '', `**Blast radius:** ${sections.blast || 'not stated'}`];
  if (weakened.length) out.push('', 'Checks this change weakens:', '', weakenedList(weakened));
  return out;
}

export function fixPrBody({ issue, commits, files, tests, sections, refs, fixesRef, weakened, oneWay }) {
  const context = [
    issue ? `Reported in ${issue.ref}${issue.title ? `: **${issue.title}**` : ''}.` : '',
    sections.context,
  ].filter(Boolean).join('\n\n') || commits[0].subject;
  const out = ['## Context', '', context];
  if (sections.cause) out.push('', '## Root cause', '', sections.cause);
  if (sections.rationale) out.push('', '## Rationale', '', sections.rationale);
  out.push('', '## What changed', '');
  if (sections.fix) out.push(sections.fix, '');
  if (sections.other) out.push(sections.other, '');
  out.push(commits.map((c) => `- ${c.subject}`).join('\n'));
  if (files.length) out.push('', fileList(files));
  out.push('', '## How it was verified', '', verification(tests, sections.verification));
  out.push('', ...mergeDanger(sections, oneWay, weakened));
  const footers = [fixesRef ? `Fixes ${fixesRef}` : '', refs.length ? `Refs: ${refs.join(', ')}` : ''].filter(Boolean);
  if (footers.length) out.push('', footers.join('\n'));
  return out.join('\n');
}

export function featurePrBody({ goal, specRel, trackingRef, tasks, files, tests, criteria, rulings, reviewFocus, footers, weakened }) {
  const out = ['## Context', '', goal, '', `Design: \`${specRel}\` in the hub${trackingRef ? ` · tracking issue ${trackingRef}` : ''}.`];
  out.push('', '## What changed', '', tasks);
  if (files.length) out.push('', fileList(files));
  out.push('', '## Acceptance criteria', '', criteria);
  out.push('', '## Decisions made during implementation', '', rulings.length ? rulings.map((r) => `- ${r}`).join('\n') : '- None: the plan was followed as written.');
  if (reviewFocus) out.push('', '## Review focus', '', reviewFocus);
  out.push('', '## How it was verified', '', verification(tests, tests.length ? 'Tests that prove an acceptance criterion are titled with its ID.' : ''));
  if (weakened?.length) out.push('', '## Checks weakened', '', weakenedList(weakened));
  out.push('', footers);
  return out.join('\n');
}
