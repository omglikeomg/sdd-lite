// Deterministic checks for skills: structure, trigger prompts and description collisions.
// Triggering is approximated lexically: each skill's name and description become a TF-IDF vector,
// and a prompt "fires" the skill whose vector is closest. It cannot judge meaning (the on-demand
// `pnpm skills:eval` does that); it catches a description missing the words people say, and two
// descriptions drifting into each other.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter, headings, section } from './markdown.mjs';

export const REQUIRED_SECTIONS = ['Overview', 'When NOT to use', 'Red flags', 'Verification'];
export const MIN_POSITIVE = 3;
export const MIN_NEGATIVE = 2;
const MAX_DESCRIPTION = 1024;
const MAX_WHAT = 200;
const MAX_LINES = 500;

// Skills in `root/<folder>/SKILL.md`, named `<prefix><name>` (prefix `superpowers:` for those).
export function loadSkills(root, prefix = '') {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'SKILL.md')))
    .map((d) => {
      const text = readFileSync(join(root, d.name, 'SKILL.md'), 'utf8');
      const { data } = splitFrontmatter(text);
      return { folder: d.name, name: `${prefix}${data.name ?? d.name}`, description: String(data.description ?? ''), text };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function structureProblems(skill) {
  const problems = [];
  const { data } = splitFrontmatter(skill.text);
  if (data.name !== skill.folder) problems.push(`name "${data.name}" does not match its folder "${skill.folder}"`);
  const d = skill.description;
  if (!d.startsWith('Use when')) problems.push('description must start with "Use when"');
  if (d.length > MAX_DESCRIPTION) problems.push(`description is ${d.length} characters; the limit is ${MAX_DESCRIPTION}`);
  const parts = d.split(' - ');
  if (parts.length !== 2 || !parts[1].trim()) {
    problems.push('description needs one " - " followed by a short clause saying what the skill does');
  } else {
    const what = parts[1].trim();
    if (/\b(then|before|after|first)\b|;/i.test(what)) {
      problems.push('the what clause summarises steps ("then", "before", "after", "first" or ";"); say what the skill does, not how');
    }
    if (what.length > MAX_WHAT) problems.push(`the what clause is ${what.length} characters; keep it to ${MAX_WHAT}`);
  }
  const titles = new Set(headings(skill.text).filter((h) => h.level === 2).map((h) => h.title));
  for (const t of REQUIRED_SECTIONS) if (!titles.has(t)) problems.push(`missing section "## ${t}"`);
  if (titles.has('Verification')) {
    const items = section(skill.text, 'Verification').text.split('\n').filter((l) => /^\s*- \[ \]/.test(l));
    if (!items.length) problems.push('Verification has no checklist items');
    for (const item of items) {
      if (!/ — \*\*Evidence:\*\* \S/.test(item)) {
        problems.push(`Verification item names no evidence ("— **Evidence:** …"): "${item.replace(/^\s*- \[ \]\s*/, '')}"`);
      }
    }
  }
  const lines = skill.text.split('\n').length;
  if (lines >= MAX_LINES) problems.push(`SKILL.md has ${lines} lines; keep it under ${MAX_LINES}`);
  return problems;
}

const STOP = new Set(
  ('a an and any are as at be been but by can do for from has have how i if in into is it its me my no not of on or our ' +
    'so some that the their them then there these they this to us use was we what when where which who will with you your ' +
    'someone something asks needs want wants please just one').split(' '),
);

// Crude suffix stripping, enough for "reviewing"/"review", "commits"/"commit", "designs"/"design".
function stem(word) {
  let w = word;
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix) && !w.endsWith('ss')) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.length > 4 && w.at(-1) === w.at(-2) && !'aeiou'.includes(w.at(-1))) w = w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

const counts = (tokens) => tokens.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, w] of a) {
    na += w * w;
    dot += w * (b.get(t) || 0);
  }
  for (const w of b.values()) nb += w * w;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// skills: [{ name, description }]. The name counts as part of the text (without its prefix).
export function buildIndex(skills) {
  const docs = new Map(skills.map((s) => [s.name, counts(tokenize(`${s.name.replace(/^.*:/, '').replace(/-/g, ' ')} ${s.description}`))]));
  const df = new Map();
  for (const tf of docs.values()) for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + docs.size / (1 + (df.get(t) || 0)));
  const weigh = (tf) => new Map([...tf].map(([t, f]) => [t, f * idf(t)]));
  const vectors = new Map([...docs].map(([name, tf]) => [name, weigh(tf)]));
  return {
    names: [...vectors.keys()],
    has: (name) => vectors.has(name),
    rank(prompt) {
      const p = weigh(counts(tokenize(prompt)));
      return [...vectors].map(([name, v]) => ({ name, score: cosine(p, v) })).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    },
    similarity: (a, b) => cosine(vectors.get(a), vectors.get(b)),
  };
}

const describe = (ranking, n = 3) => ranking.slice(0, n).map((r) => `${r.name} ${r.score.toFixed(2)}`).join(', ');

// cases: { positive: [string], negative: [{ prompt, owner }] }. An owner named `superpowers:…` that
// the index lacks is skipped: Superpowers is not installed here.
export function triggerProblems(skill, cases, index) {
  const problems = [];
  const skipped = [];
  const positive = cases.positive ?? [];
  const negative = cases.negative ?? [];
  if (positive.length < MIN_POSITIVE) problems.push(`needs at least ${MIN_POSITIVE} prompts that should fire it (has ${positive.length})`);
  if (negative.length < MIN_NEGATIVE) problems.push(`needs at least ${MIN_NEGATIVE} prompts that should stay quiet (has ${negative.length})`);
  for (const prompt of positive) {
    const ranking = index.rank(prompt);
    const at = ranking.findIndex((r) => r.name === skill);
    if (at !== 0 || ranking[0].score === 0) {
      problems.push(`should fire ${skill} but ranks #${at + 1}: "${prompt}" (#1: ${describe(ranking)})`);
    }
  }
  for (const { prompt, owner } of negative) {
    if (!index.has(owner)) {
      if (owner.startsWith('superpowers:')) skipped.push(`"${prompt}" (${owner} is not installed)`);
      else problems.push(`owner "${owner}" of "${prompt}" is not a known skill`);
      continue;
    }
    const ranking = index.rank(prompt);
    const ownerAt = ranking.findIndex((r) => r.name === owner);
    const selfAt = ranking.findIndex((r) => r.name === skill);
    if (ranking[ownerAt].score === 0 || ownerAt > selfAt) {
      problems.push(`should stay quiet for ${skill} but its owner ${owner} does not outrank it: "${prompt}" (#1: ${describe(ranking)})`);
    }
  }
  return { problems, skipped };
}

// Pairs whose descriptions are at least `threshold` alike, highest first. Pairs of two Superpowers
// skills are not the hub's to fix and are left out.
export function collisions(index, threshold) {
  const found = [];
  const names = [...index.names].sort();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [names[i], names[j]];
      if (a.startsWith('superpowers:') && b.startsWith('superpowers:')) continue;
      const score = index.similarity(a, b);
      if (score >= threshold) found.push({ a, b, score });
    }
  }
  return found.sort((x, y) => y.score - x.score);
}
