// Small, dependency-free Markdown helpers. They understand exactly the syntax the templates use.

// Frontmatter: `key: value`, `key: [a, b]`, and block lists (`key:` followed by `  - item`).
export function splitFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { has: false, data: {}, bodyStartLine: 1, error: null };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { has: true, data: {}, bodyStartLine: 1, error: 'frontmatter is not closed with ---' };
  const data = {};
  let listKey = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) return { has: true, data, bodyStartLine: end + 2, error: `cannot parse frontmatter line ${i + 1}: "${line}"` };
    const [, key, raw] = kv;
    listKey = null;
    if (raw === '') {
      data[key] = [];
      listKey = key;
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = raw.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    } else {
      data[key] = unquote(raw.trim());
    }
  }
  return { has: true, data, bodyStartLine: end + 2, error: null };
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function setFrontmatterValue(text, key, value) {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error('document has no frontmatter');
  const end = lines.indexOf('---', 1);
  for (let i = 1; i < end; i++) {
    if (lines[i].startsWith(`${key}:`)) {
      lines[i] = `${key}: ${value}`;
      return lines.join('\n');
    }
  }
  lines.splice(end, 0, `${key}: ${value}`);
  return lines.join('\n');
}

// Blank out fenced code blocks, inline code spans and the frontmatter, keeping line numbers.
export function stripCode(text) {
  const lines = text.split('\n');
  let fence = null;
  let inFrontmatter = lines[0] === '---';
  return lines
    .map((line, i) => {
      if (inFrontmatter) {
        if (i > 0 && line === '---') inFrontmatter = false;
        return '';
      }
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
        return '';
      }
      if (f) {
        fence = f[1];
        return '';
      }
      return line.replace(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (m) => ' '.repeat(m.length));
    })
    .join('\n');
}

// Inline code spans outside fenced blocks, with 1-based line numbers.
export function codeSpans(text) {
  const spans = [];
  const lines = text.split('\n');
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    for (const m of line.matchAll(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) spans.push({ code: m[2].trim(), line: i + 1 });
  });
  return spans;
}

// Inline links `[text](target)` outside code, with 1-based line numbers. Images are skipped.
export function links(text) {
  const out = [];
  stripCode(text)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1], line: i + 1 });
    });
  return out;
}

export function headings(text) {
  const out = [];
  stripCode(text)
    .split('\n')
    .forEach((line, i) => {
      const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (m) out.push({ level: m[1].length, title: m[2], line: i + 1 });
    });
  return out;
}

// Text of the section whose heading title equals `title` (first match), up to the next heading of
// the same or higher level. Returns { text, startLine } or null.
export function section(text, title) {
  const hs = headings(text);
  const idx = hs.findIndex((h) => h.title === title);
  if (idx === -1) return null;
  const h = hs[idx];
  const next = hs.slice(idx + 1).find((n) => n.level <= h.level);
  const lines = text.split('\n');
  return { text: lines.slice(h.line, next ? next.line - 1 : lines.length).join('\n'), startLine: h.line + 1 };
}
