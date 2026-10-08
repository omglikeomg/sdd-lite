# Reviewing pull requests

This guide is for the person reviewing a teammate's pull request (or one an agent opened) in a product repository. The hub prepares the review with everything it knows about the change, and your agent drafts the comments with evidence. You decide what is true, what matters and what to post. Example 5 in `docs/EXAMPLES.md` shows a whole review.

## Why review through the hub

A reviewer usually sees a diff and a description. The hub also knows:

- **What was approved.** For planned work: the design spec and its acceptance criteria, the plan, and the plan's Review Focus (what its author wanted a reviewer to look at).
- **What changed along the way.** The implementer records every deviation from the plan as a `Ruling:` on its commit, with why and what it costs if wrong.
- **What proves it.** Which criteria have a test titled with their ID at the PR's head, and which test IDs the hub does not define.
- **What constrains it.** The repository's architecture map and invariants, the area documents that cover the changed files, the contracts with other repositories, and the ADRs behind the code.
- **What depends on it.** The knowledge graph shows who calls the changed code, including callers the diff does not touch.

## The short version

```
You:    Help me review api#91.
Agent:  (runs pnpm review:start api 91, reads everything, maps the impact)
        Here are the lenses that apply. Which should I run?
You:    next
Agent:  (one lens at a time; comments in .reviews/api-91/review.md)
You:    (read, edit, post the ones you agree with on GitHub)
You:    Done, clean up.
Agent:  pnpm review:cleanup api 91
```

## Step by step

### 1. Prepare

Ask your agent, or run it yourself from the hub root:

```bash
pnpm review:start api 91
```

It fetches the PR (GitHub publishes every PR's head as `refs/pull/<n>/head`, forks included) and:

- checks out its head in `.worktrees/api--review-91`. Your `repos/api` checkout stays on `main`, and line numbers in comments come from the code under review;
- saves the diff to `.reviews/api-91/pr.diff`;
- writes `.reviews/api-91/context.md` (below);
- refreshes the knowledge graph.

Running it again after the author pushes moves the worktree to the new head and rewrites the context. `.reviews/` is never committed.

### 2. Read the context

`context.md` is worth a minute of your own time before the agent starts.

| Section | What it tells you |
|---|---|
| Commits, changed files | What the PR contains; which files are tests |
| The work this PR belongs to | Planned work: the spec, the plan, tasks with and without commits, the Review Focus, the rulings, and each criterion with the tests that cite it. A bug fix (GitHub mode): the issue it fixes, with its comments. Neither: a note to ask what the PR is for |
| Documents that govern the changed code | The repository map, covering area documents, contracts, and ADRs cited by the diff, those areas or the spec |
| Acceptance criteria cited by the changed tests | Each ID with where the hub defines it; an undefined ID is flagged |
| Team guidelines | Your team's review guidelines for this repository, and the risk checklist every review runs |

### 3. Choose the lenses

The agent reads the whole diff and every listed document, queries the graph, and proposes **lenses**: one way of looking at the change at a time.

| Lens | It asks |
|---|---|
| **Intent** | Does the PR do what was approved (or what the issue or description says), every Review Focus item included, and nothing more? Are the rulings acceptable? |
| **Proof** | Is every criterion it implements proven by a test titled with its ID? Do the tests prove the behaviour, or only touch it? |
| **Architecture** | Does it respect the invariants, the area documents and the ADRs? Does it reuse what exists or rebuild it? |
| **Contracts** | Does it break a consumer, or rely on something the provider does not promise? |
| **Risk** | Security, performance, concurrency, failure handling, compatibility, operability: the checklist in `.claude/skills/review-pull-request/risk-checklist.md` |
| **Team guideline** | One lens per guideline your team listed for the repository |

Say "next" to follow the suggested order, name the lenses you want, or say "all" for one pass over everything. A small PR rarely needs more than Intent, Proof and Risk.

### 4. Read the comments

Each comment has a **label**:

| Label | Means | What you do |
|---|---|---|
| `[blocking]` | A defect or a broken rule the agent can show | Verify the evidence, then post it as a change request |
| `[suggestion]` | Better, not wrong | Post it if you agree; the author may decline |
| `[question]` | Looks off, may be intentional | Post it as a question; the agent uses it whenever it is not sure |
| `[nit]` | Cosmetic | Post a few at most, or skip them |
| `[heads-up]` | Easy to miss, hard to undo | Usually worth posting; at most two per review |

And two parts:

- **For the author:** file and lines, lens and label, then the comment, written as a teammate would say it, with a suggested fix where one is clear. This is the part you paste.
- **For the reviewer** (below a `---`, not for posting): what the code does today, why it is a problem, the exact code, every outside fact with its `path:line` and how it was checked, the rule it rests on, and how sure the agent is and what would prove it wrong. Read it before posting: it is what you answer with when the author replies "are you sure?".

The agent checks each comment against the worktree before showing it, makes the risky ones questions when unsure, and never posts. If a comment's reviewer part does not convince you, drop the comment.

### 5. Adjust

- "short": comments without the reviewer part, when you only want something to paste.
- "make comment 2 softer", "drop the nits": the agent rewrites just those.
- **Your own findings.** Paste the code or a path, a rough comment and a label ("nit: this 200 should be the shared constant"). The agent finds the exact lines, checks any claim you make about other code, and writes it in the same format. It adds nothing you did not raise.

### 6. Post and clean up

Copy the comments you agree with into GitHub, ideally as one review (start a review, add the comments, submit with your verdict). Then:

```bash
pnpm review:cleanup api 91
```

It removes the worktree and keeps `.reviews/api-91/` with your notes; delete that folder when you no longer need it.

## Setting up team guidelines

What reviewers keep repeating belongs in a guideline: naming, error handling, testing conventions, frontend patterns. List guideline files per repository in `hub.config.json`, as hub-relative paths:

```json
{
  "name": "web",
  "reviewGuidelines": ["repos/web/docs/conventions.md", "docs/codebases/web/review.md"]
}
```

A guideline can live in the product repository (it changes with the code) or in the hub. Each becomes a lens. Keep structure and invariants in the architecture documents rather than in a guideline: those are checked against the code by `pnpm check`, guidelines are not. A listed file that does not exist is flagged in the context, not skipped.

## What it does not do

- It never posts, approves, requests changes or pushes. You do.
- It does not replace running the code. If a comment depends on runtime behaviour, the reviewer part says how sure the agent is; run the tests in the worktree when it matters (install dependencies there first).
- The graph describes `main`, not the PR: it answers "who relies on what this PR changes", not "what does the PR's code call".
- `review:start` fetches `refs/pull/<n>/head`, which GitHub publishes. Other hosts name pull requests differently.
- Reviewing your own branch before opening a PR is a different moment, covered by Superpowers' own code review during execution.
