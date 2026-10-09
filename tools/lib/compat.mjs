// What the hub relies on in Graphify and Superpowers, and the versions it was last verified with.
// `pnpm doctor` compares versions and checks the Superpowers texts; tools/test/compat.test.mjs
// also runs the real Graphify. docs/WORKFLOW.md ("Tested with") is the human-readable copy.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const TESTED = { graphify: '0.9.82', superpowers: '6.4.1' };

// Texts in the installed Superpowers that the hub's rules depend on. If one disappears, the rule
// that names it needs a fresh look.
export const SUPERPOWERS_TEXTS = [
  { file: 'skills/brainstorming/SKILL.md', text: 'Explore project context', why: 'the graphify-preflight skill is this step of brainstorming' },
  { file: 'skills/brainstorming/SKILL.md', text: 'no plan document', why: 'bounded work follows brainstorming\'s bounded path, which writes no spec or plan' },
  { file: 'skills/brainstorming/SKILL.md', text: 'User preferences for spec location override this default', why: 'the spec path printed by plan:new replaces the date-based name' },
  { file: 'skills/writing-plans/SKILL.md', text: 'User preferences for plan location override this default', why: 'the plan paths printed by plan:new replace the date-based names' },
  { file: 'skills/using-git-worktrees/SKILL.md', text: 'git-common-dir', why: 'it recognises the worktrees plan:start and work:start create as already isolated' },
  { file: 'skills/finishing-a-development-branch/SKILL.md', text: 'Push and create a Pull Request', why: 'agents finish planned and bounded work with this option' },
  { file: 'skills/subagent-driven-development/scripts/sdd-workspace', text: '.superpowers/sdd', why: 'plan:complete reads rulings from a ledger a run left there' },
  { file: 'skills/subagent-driven-development/SKILL.md', text: 'progress.md', why: 'the ledger file plan:complete reads' },
  { file: 'skills/subagent-driven-development/SKILL.md', text: 'Ruling:', why: 'the run ledgers its decisions in this form; plan:complete and the Ruling footers rely on it' },
];

const versionOf = (dir) => {
  for (const f of ['.claude-plugin/plugin.json', 'package.json']) {
    try {
      const v = JSON.parse(readFileSync(join(dir, f), 'utf8')).version;
      if (v) return v;
    } catch {}
  }
  return null;
};

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name));
  } catch {
    return [];
  }
};

// The installed Superpowers with the highest version: $SUPERPOWERS_DIR, Claude Code's plugin cache
// (~/.claude/plugins/cache/<marketplace>/superpowers/<version>/) or OpenCode's package cache.
export function findSuperpowers(env = process.env) {
  if (env.SUPERPOWERS_DIR) return existsSync(join(env.SUPERPOWERS_DIR, 'skills')) ? { dir: env.SUPERPOWERS_DIR, version: versionOf(env.SUPERPOWERS_DIR) } : null;
  const home = env.HOME || homedir();
  const candidates = subdirs(join(home, '.claude', 'plugins', 'cache')).flatMap((m) => subdirs(join(m, 'superpowers')));
  const walk = (dir, depth) => {
    if (depth < 0) return;
    for (const d of subdirs(dir)) {
      if (d.endsWith('/node_modules/superpowers')) candidates.push(d);
      else walk(d, depth - 1);
    }
  };
  walk(join(home, '.cache', 'opencode', 'packages'), 5);
  const found = candidates.filter((d) => existsSync(join(d, 'skills'))).map((dir) => ({ dir, version: versionOf(dir) }));
  found.sort((x, y) => compareVersions(y.version || '0', x.version || '0'));
  return found[0] || null;
}

export function superpowersProblems(dir) {
  return SUPERPOWERS_TEXTS.filter(({ file, text }) => {
    const abs = join(dir, file);
    return !existsSync(abs) || !readFileSync(abs, 'utf8').includes(text);
  }).map(({ file, text, why }) => `${file} no longer contains "${text}" (${why})`);
}
