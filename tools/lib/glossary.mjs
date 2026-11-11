// The format of docs/GLOSSARY.md (ADR-0004): contexts are `##` headings, terms are `###` headings
// under a context, and each term holds one definition paragraph of at most two sentences, then
// optionally one `_Avoid_:` line. No personal data: no email addresses, no @-mentions.
import { stripCode } from './markdown.mjs';

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const STRUCTURE = /^\s*([-*+]\s|\d+\.\s|\||>|`{3,}|~{3,})/;
const AVOID = /^_Avoid_:\s*(.*)$/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const MENTION = /(^|[\s(])@[A-Za-z0-9][\w-]*/;

export function glossaryProblems(text) {
  const raw = text.split('\n');
  const prose = stripCode(text).split('\n');
  const problems = [];
  const report = (line, message) => problems.push({ line, message });

  raw.forEach((line, i) => {
    if (EMAIL.test(line)) report(i + 1, 'an email address is personal data; the glossary holds none');
    else if (MENTION.test(prose[i])) report(i + 1, 'an @-mention names a person; the glossary holds no personal data');
  });

  const terms = [];
  let inContext = false;
  let term = null;
  const close = (end) => {
    if (term) terms.push({ ...term, body: raw.slice(term.line, end).map((l, k) => ({ raw: l, prose: prose[term.line + k], line: term.line + k + 1 })) });
    term = null;
  };
  prose.forEach((line, i) => {
    const h = HEADING.exec(line);
    if (!h) return;
    close(i);
    const level = h[1].length;
    if (level === 2) inContext = true;
    else if (level === 3) {
      if (!inContext) report(i + 1, `term "${h[2]}" is not under a "## " context`);
      term = { name: h[2], line: i + 1 };
    } else if (level > 3) report(i + 1, 'headings deeper than ### are not allowed: a term holds only its definition');
  });
  close(raw.length);

  const seen = new Map();
  for (const t of terms) {
    const key = t.name.toLowerCase();
    if (seen.has(key)) report(t.line, `"${t.name}" is defined twice (first at line ${seen.get(key)})`);
    else seen.set(key, t.line);
  }

  for (const t of terms) {
    const blocks = [];
    let current = null;
    for (const l of t.body) {
      if (l.raw.trim() === '') current = null;
      else {
        if (!current) blocks.push((current = []));
        current.push(l);
      }
    }
    const last = blocks.at(-1)?.at(-1);
    const avoid = last && AVOID.exec(last.raw);
    if (avoid) {
      blocks.at(-1).pop();
      if (blocks.at(-1).length === 0) blocks.pop();
      for (const word of avoid[1].split(',').map((w) => w.trim().replace(/\.$/, '').trim()).filter(Boolean)) {
        if (seen.has(word.toLowerCase())) report(last.line, `"${word}" is listed under _Avoid_ but is a term`);
      }
    }
    if (blocks.length === 0) {
      report(t.line, `"${t.name}" has no definition`);
      continue;
    }
    if (blocks.length > 1 || blocks[0].some((l) => STRUCTURE.test(l.raw))) {
      report(blocks[blocks.length > 1 ? 1 : 0][0].line, `"${t.name}": only one definition paragraph and an optional "_Avoid_:" line belong under a term`);
      continue;
    }
    const sentences = (blocks[0].map((l) => l.prose).join(' ').match(/[.!?](\s|$)/g) || []).length;
    if (sentences > 2) report(blocks[0][0].line, `"${t.name}": the definition has ${sentences} sentences; the limit is two`);
  }
  return problems.sort((a, b) => a.line - b.line);
}
