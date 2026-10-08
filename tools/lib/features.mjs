// Moving acceptance criteria from a design spec into the living feature documents.
import { section } from './markdown.mjs';
import { isAcId } from './conventions.mjs';

const BLOCK_START = /^- \*\*([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+)\*\*/;

// Bullet blocks `- **ID** …` plus their indented continuation lines, in order.
export function criteriaBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    const m = BLOCK_START.exec(line);
    if (m && isAcId(m[1])) {
      current = { id: m[1], lines: [line] };
      blocks.push(current);
    } else if (current && /^\s+\S/.test(line)) current.lines.push(line);
    else current = null;
  }
  return blocks;
}

// A feature target is a Markdown link (relative to the spec) to an existing document, or a
// backticked hub path (`docs/features/x.md`) for a document the completion will create.
const TARGET = /(?:\]\(([^)\s]+)\)|`(docs\/features\/[^`]+\.md)`)/;
const target = (line) => {
  const m = TARGET.exec(line);
  return m ? m[1] || m[2] : null;
};

// A spec's acceptance criteria, split into those it adds or changes and those it retires. Retired
// criteria sit under a "### Removed" heading inside "## Acceptance criteria", one bullet each with
// the reason: "- **NOTES-OLD-1** Archiving replaces deletion, so this no longer applies."
export function splitCriteria(acText) {
  const parts = acText.split(/^(?=### )/m);
  const removedPart = parts.find((p) => /^### Removed\s*$/m.test(p.split('\n')[0]));
  const rest = parts.filter((p) => p !== removedPart).join('');
  return { text: rest, added: criteriaBlocks(rest), removed: removedPart ? criteriaBlocks(removedPart) : [] };
}

export function removeCriteria(featureText, ids) {
  const blocks = criteriaBlocks(featureText).filter((b) => ids.includes(b.id));
  let out = featureText;
  for (const b of blocks) out = out.replace(`${b.lines.join('\n')}\n`, '');
  return { text: out, removed: blocks.map((b) => b.id) };
}

// Group the spec's criteria by target feature document. The spec's `## Acceptance criteria` may
// group criteria under `### <feature target>` headings; otherwise every criterion goes to the
// single `Feature:` target in `## Links`. Returns Map<target, blocks[]>.
export function criteriaByFeature(specText) {
  const acSection = section(specText, 'Acceptance criteria');
  if (!acSection) return new Map();
  const ac = { text: splitCriteria(acSection.text).text };
  const groups = new Map();
  const parts = ac.text.split(/^(?=### )/m);
  const grouped = parts.filter((p) => p.startsWith('### ') && target(p.split('\n')[0]));
  if (grouped.length) {
    for (const p of grouped) {
      const link = target(p.split('\n')[0]);
      groups.set(link, [...(groups.get(link) || []), ...criteriaBlocks(p)]);
    }
    return groups;
  }
  const blocks = criteriaBlocks(ac.text);
  if (blocks.length === 0) return groups;
  const linksSection = section(specText, 'Links');
  const featureLinks = linksSection ? linksSection.text.split('\n').filter((l) => l.startsWith('- Feature:')).map(target).filter(Boolean) : [];
  if (featureLinks.length !== 1) {
    throw new Error('the spec defines acceptance criteria, so its "## Links" needs exactly one "- Feature:" line ' +
      '(a link to an existing feature document, or `docs/features/<name>.md` for a new one), or group the criteria under "### " headings naming their feature');
  }
  groups.set(featureLinks[0], blocks);
  return groups;
}

// Insert or replace criteria (by ID) in a feature document's `## Acceptance criteria` section.
export function mergeCriteria(featureText, blocks) {
  const lines = featureText.split('\n');
  let start = lines.findIndex((l) => /^## Acceptance criteria\s*$/.test(l));
  if (start === -1) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', '## Acceptance criteria', '');
    start = lines.length - 2;
  }
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  if (end === -1) end = lines.length;
  const sectionLines = lines.slice(start + 1, end);
  const existing = criteriaBlocks(sectionLines.join('\n'));
  let body = sectionLines.join('\n');
  const appended = [];
  for (const b of blocks) {
    const old = existing.find((e) => e.id === b.id);
    if (old) body = body.replace(old.lines.join('\n'), b.lines.join('\n'));
    else appended.push(b.lines.join('\n'));
  }
  if (appended.length) body = body.replace(/\s*$/, '') + '\n' + appended.join('\n') + '\n';
  if (!body.startsWith('\n')) body = '\n' + body;
  if (end < lines.length && !body.endsWith('\n\n')) body = body.replace(/\n*$/, '\n\n');
  return [...lines.slice(0, start + 1), ...body.replace(/\n$/, '').split('\n'), ...lines.slice(end)].join('\n').replace(/\n*$/, '\n');
}

export function newFeatureDoc(title, intro = '') {
  return `---\ntype: feature\n---\n# ${title}\n\n${intro ? `${intro.trim()}\n\n` : ''}## Acceptance criteria\n`;
}
