// Naming and message conventions. docs/WORKFLOW.md is the human-readable source of these rules.

export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const TYPES = COMMIT_TYPES.join('|');

export const ID_RE = /^\d{6}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const REPO_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PLAN_BRANCH_RE = new RegExp(`^(${TYPES})/(\\d{6})-([a-z0-9]+(?:-[a-z0-9]+)*)$`);
const TYPED_BRANCH_RE = new RegExp(`^(${TYPES})/`);
const BOUNDED_BRANCH_RE = new RegExp(`^(${TYPES})/[a-z0-9]+(?:-[a-z0-9]+)*$`);

export function parsePlanBranch(name) {
  const m = PLAN_BRANCH_RE.exec(name || '');
  return m ? { type: m[1], id: m[2], slug: m[3] } : null;
}

// Returns an error message for a branch that uses a commit-type prefix but neither the plan
// pattern nor the bounded pattern; branches without a type prefix are left to the team.
export function branchNameError(name) {
  if (!TYPED_BRANCH_RE.test(name || '')) return null;
  if (PLAN_BRANCH_RE.test(name)) return null;
  // A digit-prefixed slug claims to be planned work, so it must carry a valid six-digit ID.
  if (!/^[a-z]+\/\d+-/.test(name) && BOUNDED_BRANCH_RE.test(name)) return null;
  return `branch "${name}" must be <type>/<6-digit plan id>-<slug> (planned work) or <type>/<slug> (bounded work)`;
}

export function parseSpecFilename(base) {
  const m = /^(\d{6})-([a-z0-9]+(?:-[a-z0-9]+)*)-design\.md$/.exec(base);
  return m ? { id: m[1], slug: m[2] } : null;
}

export function parsePlanFilename(base) {
  const m = /^(\d{6})-([a-z0-9]+(?:-[a-z0-9]+)*)--([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(base);
  return m ? { id: m[1], slug: m[2], repo: m[3] } : null;
}

const HEADER_RE = new RegExp(`^(${TYPES})(\\([a-z0-9][a-z0-9._/-]*\\))?(!)?: \\S`);

export function commitHeaderError(header) {
  if (!header) return 'commit message is empty';
  if (/^(fixup|squash|amend)! /.test(header) || /^Merge /.test(header) || /^Revert "/.test(header)) return null;
  if (!HEADER_RE.test(header)) {
    return `commit header "${header}" is not a Conventional Commit: <type>(<scope>)!: <summary>, type one of ${COMMIT_TYPES.join(', ')}`;
  }
  return null;
}

// Remove git comment lines and everything below the scissors line.
export function cleanMessage(raw) {
  const lines = raw.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^# -+ >8 -+$/.test(line)) break;
    if (line.startsWith('#')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

// Values of the footer keys this workflow uses. Lines are matched anywhere in the message so a
// squash commit whose body concatenates task commits still exposes them.
export function footerValues(message, key) {
  const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'gm');
  const values = [];
  for (const m of message.matchAll(re)) values.push(m[1]);
  return values;
}

export function taskNumbers(message) {
  const nums = new Set();
  for (const v of footerValues(message, 'Task')) {
    for (const part of v.split(/[,\s]+/).filter(Boolean)) {
      if (/^\d+$/.test(part)) nums.add(Number(part));
    }
  }
  return nums;
}

// Acceptance-criteria IDs: uppercase segments ending in a number, e.g. BILL-ISSUE-1. ADR and RFC
// prefixes are reserved for Graphify's citation pattern.
const AC_BODY = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\\d+';
export const AC_ID_RE = new RegExp(`^${AC_BODY}$`);
export function isAcId(token) {
  return AC_ID_RE.test(token) && !/^(ADR|RFC|REQ)-/.test(token);
}

// Product requirements in an epic's PRD: **REQ-<n>**, numbered per epic.
export const REQ_DEFINITION_RE = /\*\*(REQ-\d+)\*\*/g;
export const REQ_REF_RE = /\bREQ-\d+\b/g;
export const AC_DEFINITION_RE = new RegExp(`\\*\\*(${AC_BODY})\\*\\*`, 'g');
// A test title is a string literal opened right after "(": it('ID: …'), test.describe("ID: …"), and
// the title call of table tests, it.each([...])('ID: %s …'), whose table may span several lines.
export const TEST_TITLE_AC_RE = new RegExp(`\\(\\s*['"\`](${AC_BODY}):`, 'g');

export const ADR_REF_RE = /\bADR-(\d{1,5})\b/g;
export function adrLabel(num) {
  return `ADR-${String(Number(num)).padStart(4, '0')}`;
}

export const SPEC_STATUSES = ['draft', 'approved', 'in-progress', 'done', 'abandoned'];
export const ADR_STATUSES = ['proposed', 'accepted', 'superseded'];
export const SPIKE_STATUSES = ['draft', 'done'];

export function planPath(id, slug, repo) {
  return `docs/superpowers/plans/${id}-${slug}--${repo}.md`;
}
export function specPath(id, slug) {
  return `docs/superpowers/specs/${id}-${slug}-design.md`;
}
export function worktreeDirName(repo, id, slug) {
  return `${repo}--${id}-${slug}`;
}
