// GitHub mode: everything the hub does on GitHub goes through the `gh` CLI here. Files in the hub
// stay the source of truth; GitHub is a projection that commands update at fixed moments.
import { spawnSync } from 'node:child_process';
import { HubError } from './hub.mjs';

export const STATUS = { ongoing: 'status:ongoing', review: 'status:pending-review', manual: 'status:needs-manual-steps' };

// Labels the hub creates. `owner` documents who may change them (see docs/GITHUB.md).
export const STATIC_LABELS = [
  { name: STATUS.ongoing, color: 'fbca04', description: 'Being designed or implemented', owner: 'commands' },
  { name: STATUS.review, color: '0e8a16', description: 'A PR is waiting for review', owner: 'commands' },
  { name: STATUS.manual, color: 'd93f0b', description: 'Shipped, but people must still do something (see the last comment)', owner: 'commands' },
  { name: 'tier:architectural', color: '5319e7', description: 'Planned work with a design spec', owner: 'commands' },
  { name: 'tier:bounded', color: 'c5def5', description: 'Small change to an existing flow', owner: 'commands' },
  { name: 'tier:epic', color: '3e4b9e', description: 'An outcome delivered in phases; its sub-issues are the phases', owner: 'commands' },
  ...['feat', 'fix', 'refactor', 'perf', 'chore', 'docs'].map((t) => ({ name: `type:${t}`, color: 'bfdadc', description: `Conventional Commit type ${t}`, owner: 'commands' })),
  { name: 'breaking-change', color: 'b60205', description: 'Changes behaviour other code or clients rely on', owner: 'commands' },
  { name: 'kind:feature', color: 'a2eeef', description: 'Request for new behaviour', owner: 'issue forms' },
  { name: 'kind:bug', color: 'ee0701', description: 'Something does not work as described', owner: 'issue forms' },
  ...['p0', 'p1', 'p2', 'p3'].map((p) => ({ name: `priority:${p}`, color: 'ededed', description: `Priority ${p.toUpperCase()}`, owner: 'people' })),
  { name: 'blocked', color: '000000', description: 'Waiting on something outside this work', owner: 'people' },
  { name: 'needs-info', color: 'd4c5f9', description: 'The request needs more detail before work starts', owner: 'people' },
];
export const repoLabel = (name) => ({ name: `repo:${name}`, color: '1d76db', description: `Touches the ${name} repository` });
export const epicLabel = (slug) => ({ name: `epic:${slug}`, color: '3e4b9e', description: `Part of epic ${slug}` });

function gh(args, input) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input });
  if (r.error) throw new HubError('GitHub mode needs the `gh` CLI on PATH (https://cli.github.com)');
  if (r.status !== 0) throw new HubError(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export function requireGh() {
  const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  if (r.error) throw new HubError('GitHub mode is on in hub.config.json, but the `gh` CLI is not installed (see docs/GITHUB.md)');
  if (r.status !== 0) throw new HubError('GitHub mode is on, but `gh` is not logged in; run `gh auth login` (see docs/GITHUB.md)');
}

// "owner/name" from an SSH or HTTPS GitHub URL, including SSH host aliases such as github.com-personal.
export function slugFromUrl(url) {
  const m = /github\.com[^:/]*[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url || '');
  return m ? `${m[1]}/${m[2]}` : null;
}

// "17" (in the hub repository) or "owner/name#17".
export function parseIssueRef(ref, hubRepo) {
  const m = /^(?:([\w.-]+\/[\w.-]+)#)?(\d+)$/.exec(String(ref || ''));
  if (!m) throw new HubError(`"${ref}" is not an issue reference; use 17 or owner/repo#17`);
  return { repo: m[1] || hubRepo, number: Number(m[2]) };
}

const numberFromUrl = (url) => {
  const m = /\/(?:issues|pull)\/(\d+)\s*$/.exec(url);
  if (!m) throw new HubError(`unexpected gh output: ${url}`);
  return Number(m[1]);
};

export function ensureLabels(repo, labels) {
  for (const l of labels) gh(['label', 'create', l.name, '--repo', repo, '--color', l.color, '--description', l.description, '--force']);
}

export function createIssue(repo, title, body, labels = []) {
  const url = gh(['issue', 'create', '--repo', repo, '--title', title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l])], body);
  return { number: numberFromUrl(url), url };
}

export function viewIssue(repo, number) {
  return JSON.parse(gh(['issue', 'view', String(number), '--repo', repo, '--json', 'number,title,body,url,state,labels,comments']));
}

// Each step's comment carries a hidden marker, so rerunning a step after a failure never posts it
// twice. Returns the comment URL, or null when the comment was already there.
export function comment(repo, number, body, marker) {
  const tag = marker ? `<!-- hub:${marker} -->` : '';
  if (tag && viewIssue(repo, number).comments.some((c) => (c.body || '').includes(tag))) return null;
  return gh(['issue', 'comment', String(number), '--repo', repo, '--body-file', '-'], tag ? `${body}\n\n${tag}` : body);
}

export function addLabels(repo, number, labels) {
  if (labels.length) gh(['issue', 'edit', String(number), '--repo', repo, ...labels.flatMap((l) => ['--add-label', l])]);
}

// Replace whichever status:* label the issue has with `status`.
export function setStatus(repo, number, status) {
  const current = viewIssue(repo, number).labels.map((l) => l.name).filter((n) => n.startsWith('status:') && n !== status);
  gh(['issue', 'edit', String(number), '--repo', repo, '--add-label', status, ...current.flatMap((l) => ['--remove-label', l])]);
}

export function viewPr(repo, number) {
  return JSON.parse(gh(['pr', 'view', String(number), '--repo', repo, '--json', 'number,title,body,url,headRefName,baseRefName']));
}

export function openPrFor(repo, head) {
  const open = JSON.parse(gh(['pr', 'list', '--repo', repo, '--head', head, '--state', 'open', '--json', 'number,url']) || '[]');
  return open[0] || null;
}

// Opens the PR, or returns the open PR that already exists for `head` (a rerun after a failure).
export function createPr(repo, { head, base, title, body, labels = [] }) {
  const open = JSON.parse(gh(['pr', 'list', '--repo', repo, '--head', head, '--state', 'open', '--json', 'number,url']) || '[]');
  if (open.length) {
    if (labels.length) gh(['pr', 'edit', String(open[0].number), '--repo', repo, ...labels.flatMap((l) => ['--add-label', l])]);
    return { number: open[0].number, url: open[0].url, reused: true };
  }
  const url = gh(['pr', 'create', '--repo', repo, '--head', head, '--base', base, '--title', title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l])], body);
  return { number: numberFromUrl(url), url, reused: false };
}

// Make `child` a sub-issue of `parent` (both in `repo`). Returns false when GitHub refuses, for
// example on plans without sub-issues; the epic label still groups the work.
export function addSubIssue(repo, parent, child) {
  const id = gh(['api', `repos/${repo}/issues/${child}`, '--jq', '.id']);
  const r = spawnSync('gh', ['api', '-X', 'POST', `repos/${repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${id}`], { encoding: 'utf8' });
  return r.status === 0 || /already/i.test(r.stderr || '');
}

export function editIssueBody(repo, number, body) {
  gh(['issue', 'edit', String(number), '--repo', repo, '--body-file', '-'], body);
}

export function closeIssue(repo, number, reason = 'not planned') {
  gh(['issue', 'close', String(number), '--repo', repo, '--reason', reason]);
}

export function closePr(repo, number, body) {
  gh(['pr', 'close', String(number), '--repo', repo, '--comment', body]);
}

export function removeLabels(repo, number, prefix) {
  const present = viewIssue(repo, number).labels.map((l) => l.name).filter((n) => n.startsWith(prefix));
  if (present.length) gh(['issue', 'edit', String(number), '--repo', repo, ...present.flatMap((l) => ['--remove-label', l])]);
}
