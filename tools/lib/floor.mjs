// Moves that lower the bar, read from a unified diff: suppressions, skipped and
// deleted tests, removed assertions and lowered coverage thresholds. A report for reviewers, not a
// gate: the list is data so the PR text and the review context can each present it.
import { SKIPPED_TEST_RE } from './conventions.mjs';

const SUPPRESSION_RE = /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|biome-ignore|istanbul ignore|c8 ignore|#\s*noqa\b|#\s*type:\s*ignore/;
const ASSERTION_RE = /\bexpect\s*\(|\bassert\b/;
const THRESHOLD_RE = /\b(lines|branches|functions|statements|fail[_-]under)["']?\s*[:=]\s*(\d+(?:\.\d+)?)/;

function parseDiff(diff) {
  const files = [];
  let f = null;
  let line = 0;
  let inHeader = false;
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff ')) {
      f = { path: '', oldPath: '', deleted: false, added: [], removed: [] };
      files.push(f);
      inHeader = true;
    } else if (!f) continue;
    else if (l.startsWith('@@')) {
      inHeader = false;
      line = Number(/\+(\d+)/.exec(l)[1]);
    } else if (inHeader) {
      if (l.startsWith('--- ')) f.oldPath = l.slice(4).replace(/^a\//, '');
      else if (l.startsWith('+++ ')) {
        f.deleted = l === '+++ /dev/null';
        f.path = f.deleted ? f.oldPath : l.slice(4).replace(/^b\//, '');
      }
    } else if (l.startsWith('+')) f.added.push({ line: line++, text: l.slice(1) });
    else if (l.startsWith('-')) f.removed.push(l.slice(1));
    else if (l.startsWith(' ')) line++;
  }
  return files;
}

export function weakenedChecks(diff, isTest) {
  const out = [];
  for (const f of parseDiff(diff)) {
    const test = isTest(f.path);
    if (f.deleted) {
      if (test) out.push({ kind: 'deleted-test', file: f.path, line: null, text: 'test file deleted' });
      continue;
    }
    for (const a of f.added) {
      if (SUPPRESSION_RE.test(a.text)) out.push({ kind: 'suppression', file: f.path, line: a.line, text: a.text.trim() });
      if (test && SKIPPED_TEST_RE.test(a.text)) out.push({ kind: 'skipped-test', file: f.path, line: a.line, text: a.text.trim() });
    }
    if (test) {
      const fewer = f.removed.filter((t) => ASSERTION_RE.test(t)).length - f.added.filter((a) => ASSERTION_RE.test(a.text)).length;
      if (fewer > 0) out.push({ kind: 'removed-assertions', file: f.path, line: null, text: `${fewer} fewer assertion${fewer > 1 ? 's' : ''}` });
      continue;
    }
    const was = new Map();
    for (const t of f.removed) {
      const m = THRESHOLD_RE.exec(t);
      if (m && !was.has(m[1])) was.set(m[1], Number(m[2]));
    }
    for (const a of f.added) {
      const m = THRESHOLD_RE.exec(a.text);
      if (!m || !was.has(m[1])) continue;
      if (Number(m[2]) < was.get(m[1])) out.push({ kind: 'lowered-threshold', file: f.path, line: a.line, text: `${m[1]}: ${was.get(m[1])} → ${m[2]}` });
      was.delete(m[1]);
    }
  }
  return out;
}
