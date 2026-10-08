// What the hub writes in product-repository pull requests. Reviewers read top to bottom: why the
// change exists, what changed, why it is right, how we know it works. Footers stay last, because
// the squash commit keeps them.

const LABELS = { Context: 'context', Cause: 'cause', Rationale: 'rationale', Fix: 'fix', Change: 'fix', Verification: 'verification', Risk: 'risk' };

// Split commit-body prose into the labelled paragraphs bounded work uses (`Cause: …`, `Fix: …`);
// unlabelled paragraphs are kept in `other`.
export function explanationSections(bodies) {
  const sections = { context: [], cause: [], rationale: [], fix: [], verification: [], risk: [], other: [] };
  const LABEL_LINE = /^(Context|Cause|Rationale|Fix|Change|Verification|Risk):\s*(.*)$/;
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

export function fixPrBody({ issue, commits, files, tests, sections, refs, fixesRef }) {
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
  if (sections.risk) out.push('', '## Risk', '', sections.risk);
  const footers = [fixesRef ? `Fixes ${fixesRef}` : '', refs.length ? `Refs: ${refs.join(', ')}` : ''].filter(Boolean);
  if (footers.length) out.push('', footers.join('\n'));
  return out.join('\n');
}

export function featurePrBody({ goal, specRel, trackingRef, tasks, files, tests, criteria, rulings, reviewFocus, footers }) {
  const out = ['## Context', '', goal, '', `Design: \`${specRel}\` in the hub${trackingRef ? ` · tracking issue ${trackingRef}` : ''}.`];
  out.push('', '## What changed', '', tasks);
  if (files.length) out.push('', fileList(files));
  out.push('', '## Acceptance criteria', '', criteria);
  out.push('', '## Decisions made during implementation', '', rulings.length ? rulings.map((r) => `- ${r}`).join('\n') : '- None: the plan was followed as written.');
  if (reviewFocus) out.push('', '## Review focus', '', reviewFocus);
  out.push('', '## How it was verified', '', verification(tests, tests.length ? 'Tests that prove an acceptance criterion are titled with its ID.' : ''));
  out.push('', footers);
  return out.join('\n');
}
