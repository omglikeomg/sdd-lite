---
name: review-pull-request
description: Use when your human partner asks for help reviewing a pull request someone else wrote (a teammate's or another agent's) in a product repository of the hub, or wants a finding of their own written up as a review comment
---

# Review a pull request

## Overview

You help a person review someone else's code. They own the review: you draft comments, they decide what to post and post it. The hub gives you what a reviewer usually lacks: the approved design, the plan's review focus, the implementer's rulings, the architecture and contracts the code must respect, and a graph of who depends on what changed.

**Announce at start:** "Using review-pull-request to prepare the review of <repo>#<n>."

This is not `superpowers:requesting-code-review`, which checks your own branch before you open a PR. Here the author is someone else, and every comment must survive their reply.

<HARD-GATE>
Never post, approve or request changes on the pull request, and never push to its branch. The review worktree is read-only. Your output is a draft file and the conversation.
</HARD-GATE>

## Checklist

Create a todo for each item and complete them in order.

1. **Prepare.** From the hub root, `pnpm review:start <repo> <pr>`. It checks out the PR's head in `.worktrees/<repo>--review-<pr>`, saves the diff, refreshes the graph and writes `.reviews/<repo>-<pr>/context.md`. Read the context file whole.
2. **Read the diff end to end.** `.reviews/<repo>-<pr>/pr.diff` can be long: keep reading with an increasing offset until the last line. Most missed findings come from reviewing only the first part.
3. **Read what governs the change.** Every document the context lists: the repository map (invariants first), covering area documents, contracts, ADRs, the design spec and plan when there is one, the issue when there is one, and the team guidelines. Note a listed guideline that is missing; do not skip it silently.
4. **Map the impact.** For each changed exported symbol, route or module, `graphify explain "<Symbol>"` and, where two parts must stay connected, `graphify path "<A>" "<B>"`. The graph describes the default branch, so it shows who relies on the code being changed. Callers the diff does not touch, and documents citing a changed file (incoming `references` edges), are what reviewers miss. Confirm each lead by opening the file; `INFERRED` edges are guesses until read.
5. **Propose the lenses** (format below) and ask which to run. In the default interactive mode, run one lens per turn and wait for "next". If your human partner says "all", run them in order and write one file.
6. **Review each lens.** Draft the comments, then make a second, independent pass over the whole diff against the same lens: files you did not cite, rules you did not check. Add what you find; drop nothing from the first pass.
7. **Verify every comment** (checklist below), then append the lens's output to `.reviews/<repo>-<pr>/review.md` and show it.
8. **Hand over.** Summarise the blocking comments in one line each. When your human partner says the review is done, suggest `pnpm review:cleanup <repo> <pr>`.

## Lenses

| Lens | When | Asks |
|---|---|---|
| **Intent** | Always | Planned work: does the PR deliver its tasks and the spec's criteria, every Review Focus item, and nothing the spec did not ask for? Are the rulings acceptable, or should one change the spec instead? Bounded work: does it fix what the issue describes, at the cause? Neither: does it do what its description says? |
| **Proof** | Always | Is every criterion this PR implements proven by a test titled with its ID? Is any test citing an ID the hub does not define, or one the spec retires? Do the tests fail without the change? |
| **Architecture** | Always | Does the change respect the repository map's invariants, the covering areas and the cited ADRs? Does it reuse what exists (step 4) or rebuild it? Does a structural change need the map updated? |
| **Contracts** | The repository provides or consumes a contract | Does it break a consumer (removed or retyped fields, changed errors) or rely on behaviour the provider does not promise? A breaking change needs an ADR. |
| **Risk** | Always | `risk-checklist.md` in this skill's folder. |
| **Team guideline** | One lens per listed guideline | The guideline's own rules. |

Living documents describe the default branch. If the change alters behaviour a feature document, contract or architecture document describes, say which document must change: in the completion PR for planned work, or in a hub PR for bounded work.

### Proposing the lenses

```markdown
| Lens | Why it applies | Files |
|---|---|---|
| Intent | Planned work 000042; 2 Review Focus items, 1 ruling | all |
| Proof | CHECKOUT-PAY-6 has no test at the PR's head | `src/payments/payments.service.spec.ts` |
| Contracts | api provides `docs/contracts/catalog.md` | `src/catalog/perfume.resolver.ts` |

Not applicable: Team guideline `docs/codebases/api/review.md` (no frontend files).
Suggested order: Intent, Proof, Risk, Architecture, Contracts. Which lenses should I run? ("next" follows the order)
```

## Comments

Write only comments that ask for a change or an answer. No praise-only comments, no restating what the code does.

| Label | Use when |
|---|---|
| `[blocking]` | A real defect or a broken rule: wrong behaviour, security, data loss, a broken contract, an unproven criterion. You can show it. |
| `[suggestion]` | Better, not wrong. The author may decline. |
| `[question]` | Something looks off but may be intentional or handled elsewhere. Ask; do not assert. When in doubt between `[blocking]` and `[question]`, it is a question. |
| `[nit]` | Cosmetic. One line. |
| `[heads-up]` | Easy to miss, hard to undo (a migration, a public API, a default that changes for everyone). At most two per review. |

Each comment has two parts.

**For the author** (ready to paste): ``` `src/payments/payments.service.ts` lines 40–52 · Intent · [blocking] ```, then the comment.
- Lead with what you noticed, in a teammate's voice: plain words, contractions, no "This code…" or "Consider…" openers.
- `[blocking]`: what is wrong, why it matters (the rule or the runtime consequence), and the fix as a `suggestion` block or numbered steps. Point to an existing example in the codebase when there is one.
- `[suggestion]`: hedge on taste ("I think", "maybe"), never on facts; offer an easy out.
- `[question]`: one honest question, no suggestion block: "<what you noticed>: intended, or am I missing something?"

**For the reviewer** (not posted, separated by `---`), enough to defend the comment in a thread without reopening the diff:
- **What happens today:** the code's behaviour, step by step.
- **Why it is a problem:** the concrete mechanism. When it rests on how a framework, runtime, database or tool behaves, explain that behaviour; link documentation only when you have opened it.
- **Evidence:** the exact code from the worktree, and every outside fact the comment relies on ("unused elsewhere", "called by the importer") as a verbatim snippet with `path:line`, what it proves, and what counter-evidence you looked for.
- **Rule:** the sentence from the spec, criterion, ADR, contract, map or guideline it rests on, and how it applies. None for a pure risk finding.
- **Confidence:** how sure you are and what would prove you wrong.

Start each lens's output with a two- or three-sentence summary for the author: warm, honest about the overall quality, no corporate phrasing. Order comments by file, then line.

### Modes

- **Full** (default): both parts.
- **Short** ("short"): the author part only.
- **Editing** (a change to a comment you delivered): reply with the updated author part only.
- **Own finding** (your partner pastes code or a path plus a rough comment and a label): write their finding up in the comment format. Open the file to find the exact lines, verify any claim it makes about other code and phrase unverified parts as questions, and add no findings of your own. Ask for the label in one line if it is missing.

## Verifying a comment

Before showing any comment:

1. Reopen the file in the review worktree; the line numbers are its current lines, never counted from the diff.
2. Read 20 lines around it. If the code now looks intentional, make it a `[question]`.
3. Every outside claim has a verbatim snippet in Evidence; otherwise drop the claim or ask.
4. Every `[blocking]` and `[suggestion]` names its rule or its runtime consequence.
5. No more than two `[heads-up]`.
6. Read only the reviewer part: could your partner defend the comment from it alone? If not, expand it.

## Red flags

| Thought | Reality |
|---|---|
| "I'll read the files in `repos/<name>`" | That checkout is the default branch, not the PR. Read the review worktree. |
| "The graph says nothing else calls it" | The graph is a lead. Search the worktree and say what you searched. |
| "The ruling looks wrong, so it is a bug" | A ruling is a recorded decision. Question it with its cost; do not treat it as an oversight. |
| "A criterion has no test here, so it is missing" | It may be proven in another repository's plan. Check the plan's tasks first. |
| "I'll post the comments to save time" | Your partner posts. Draft only. |
| "Nothing found in the first pass, done" | Do the second pass and the impact step; quiet diffs hide broken callers. |
| "I'm fairly sure it's a bug" | Fairly sure is a `[question]`. |
