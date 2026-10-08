// What the hub writes on GitHub issues. Written for product managers first: plain words, the
// behaviour before the mechanics, and every comment able to stand on its own as a status update.
const list = (items, empty) => (items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${empty}`);

export function trackingIssueBody({ id, slug, repos, type }) {
  return `**Work ${id}** · ${repos.map((r) => `\`${r}\``).join(', ')} · ${type}

This issue follows a piece of planned work from design to release. Its labels show where the work is, and each step adds a comment explaining what happened.

- Design spec: \`docs/superpowers/specs/${id}-${slug}-design.md\` (being written on branch \`docs/${id}-${slug}-spec\`)
- Work ID in commits: \`Plan: ${id}\``;
}

export function adoptedComment({ id, slug, repos }) {
  return `### Design started

This request is now planned work **${id}** in ${repos.map((r) => `\`${r}\``).join(', ')}. The design is being written in \`docs/superpowers/specs/${id}-${slug}-design.md\`; the next comment will summarise it for review.`;
}

export function specReadyComment({ goal, criteria, prUrl }) {
  return `### Design ready for review

${goal}

**Behaviour it will deliver**

${criteria || '- No behaviour changes.'}

Design PR: ${prUrl}. Approving it allows implementation to start.`;
}

export function codeReadyComment({ repo, goal, prUrl, tasks, rulings }) {
  return `### Code ready for review in \`${repo}\`

${goal}

PR: ${prUrl}

**Tasks**

${tasks}

**Decisions made during implementation**

${list(rulings, 'None: the plan was followed as written.')}`;
}

export function completionComment({ shipped, criteria, rulings, deferred, manualSteps, prUrl }) {
  const parts = [`### Shipped`, '', list(shipped, 'Nothing merged.'), '', '**Behaviour now on main**', '', criteria || '- No behaviour changes.'];
  if (manualSteps) parts.push('', '**Manual steps still needed**', '', manualSteps.trim());
  if (deferred.length) parts.push('', '**Deferred to later work**', '', list(deferred, ''));
  parts.push('', '**Decisions made during implementation**', '', list(rulings, 'None.'));
  parts.push('', `Completion PR: ${prUrl}. Merging it closes this issue${manualSteps || deferred.length ? '; the manual steps and deferred items above remain to be done' : ''}.`);
  return parts.join('\n');
}

export function boundedStartedComment({ repo, branch }) {
  return `### Work started

Being fixed in \`${repo}\` on branch \`${branch}\`. The next comment will explain the cause and the fix.`;
}

export function boundedReadyComment({ repo, summary, prUrl }) {
  return `### Fix ready for review in \`${repo}\`

${summary}

PR: ${prUrl}. Merging it closes this issue.`;
}

// The issue rendered as context for the agent that will work on it.
export function issueContext(issue, repo) {
  const comments = (issue.comments || [])
    .map((c) => `### ${c.author?.login || 'someone'} on ${String(c.createdAt || '').slice(0, 10)}\n\n${c.body}`)
    .join('\n\n');
  return `# ${repo}#${issue.number}: ${issue.title}

${issue.url}

${issue.body || '(no description)'}
${comments ? `\n## Comments\n\n${comments}\n` : ''}`;
}

export function abandonedComment({ id, reason, closed, recorded }) {
  return `### Abandoned

Work **${id}** will not be completed.

**Why:** ${reason}
${closed.length ? `\nClosed without merging: ${closed.join(', ')}.\n` : ''}
${recorded ? 'The design stays in the hub as a record with status `abandoned`, so the reasoning is not lost if this comes back.' : 'The design was never merged into the hub; this comment is its record.'}`;
}
