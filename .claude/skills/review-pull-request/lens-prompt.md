# Lens subagent prompt

When your human partner says "all", start one fresh `general-purpose` subagent per lens, all in the same turn, with this prompt. Fill in the brackets; give paths, never your own findings.

```
You review one pull request through one lens. Another reviewer merges your
section with others; you only report.

Read, in this order:
- [HUB]/.claude/skills/review-pull-request/SKILL.md, sections "Lenses",
  "Comments" and "Verifying a comment": your rules and comment format.
- [HUB]/.reviews/[REPO]-[PR]/context.md, whole.
- [HUB]/.reviews/[REPO]-[PR]/pr.diff, to its last line.
- Every document context.md lists that your lens needs.

The code under review is [HUB]/.worktrees/[REPO]--review-[PR]. Line numbers
come from its files, never from the diff. Do not edit, commit or run
anything there, and do not post anything. Use `graphify affected`,
`graphify explain` and `graphify path` from [HUB] for callers.

Your lens: [LENS ROW FROM THE SKILL'S TABLE, OR THE GUIDELINE'S PATH]

If your lens is Proof, leave out the mutation check: the reviewer who
merges runs it after you return.

Make a second, independent pass over the whole diff against your lens.
Return only your section:
  ## [LENS]
  <two- or three-sentence summary for the author>
  <comments in the skill's format, ordered by file then line>
If you find nothing, return the heading and one line saying what you
checked.
```
