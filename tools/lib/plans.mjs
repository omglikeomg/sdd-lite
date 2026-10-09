import { section } from './markdown.mjs';

const HEADER_FIELD = (name) => new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+?)\\s*$`, 'm');

// Parse the parts of a Superpowers plan this workflow relies on.
export function parsePlan(text) {
  const field = (name) => {
    const m = HEADER_FIELD(name).exec(text);
    return m ? m[1] : null;
  };
  const code = (v) => {
    const m = /`([^`]+)`/.exec(v || '');
    return m ? m[1] : null;
  };
  const specField = field('Spec');
  const specLink = specField ? /\]\(([^)\s]+)\)/.exec(specField) : null;

  const lines = text.split('\n');
  const tasks = [];
  let current = null;
  lines.forEach((line, i) => {
    const t = /^### Task (\d+):\s*(.+?)\s*$/.exec(line);
    if (t) {
      current = { number: Number(t[1]), title: t[2], line: i + 1, checkboxes: [] };
      tasks.push(current);
      return;
    }
    if (/^#{1,2} /.test(line)) {
      current = null;
      return;
    }
    const cb = /^\s*- \[( |x|X)\]/.exec(line);
    if (cb && current) current.checkboxes.push({ line: i + 1, checked: cb[1] !== ' ' });
  });

  const completion = section(text, 'Completion');
  let deferred = new Set();
  const merged = [];
  if (completion) {
    const d = section(completion.text, 'Deferred');
    if (d) for (const m of d.text.matchAll(/^- Task (\d+):/gm)) deferred.add(Number(m[1]));
    for (const m of completion.text.matchAll(/^\*\*Merged:\*\*\s*`([a-z0-9-]+\/[a-z0-9-]+)@([0-9a-f]{7,40})`/gm)) {
      merged.push({ path: m[1], sha: m[2] });
    }
  }

  return {
    spec: specLink ? specLink[1] : null,
    repoPath: code(field('Repo')),
    branch: code(field('Branch')),
    tasks,
    completion: completion ? { line: completion.startLine - 1, text: completion.text, hasRulings: !!section(completion.text, 'Rulings') } : null,
    deferred,
    merged,
  };
}

// Tick every checkbox of the given tasks; leave other tasks untouched.
export function tickTasks(text, done) {
  const lines = text.split('\n');
  let inDone = false;
  return lines
    .map((line) => {
      const t = /^### Task (\d+):/.exec(line);
      if (t) {
        inDone = done.has(Number(t[1]));
        return line;
      }
      if (/^#{1,2} /.test(line)) {
        inDone = false;
        return line;
      }
      return inDone ? line.replace(/^(\s*- )\[ \]/, '$1[x]') : line;
    })
    .join('\n');
}

// Rulings from a Superpowers subagent-driven-development ledger (`.superpowers/sdd/<plan>/progress.md`)
// that a run left behind: `Ruling: …` lines, including parked review findings
// (`Task <N>: parked — <finding> — Ruling: <why the code stands>`; older releases wrote `ruling:`).
export function rulingsFromLedger(ledgerText) {
  return ledgerText
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s+/, ''))
    .filter((l) => /\bruling:/i.test(l));
}

export function completionSection({ date, merged, rulings, deferred }) {
  const out = ['## Completion', '', `**Completed:** ${date}`, ''];
  for (const m of merged) out.push(`**Merged:** \`${m.path}@${m.sha.slice(0, 12)}\` ${m.subject}`, '');
  out.push('### Rulings', '');
  if (rulings.length === 0) out.push('- None recorded.');
  else for (const r of rulings) out.push(`- ${r}`);
  if (deferred.length) {
    out.push('', '### Deferred', '');
    for (const t of deferred) out.push(`- Task ${t.number}: ${t.title}`);
  }
  return out.join('\n') + '\n';
}
