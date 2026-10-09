---
name: hub-workflow
description: Use when starting, resuming, handing off or finishing any work in the hub or its product repositories under repos/ - before creating branches, worktrees, commits, pull requests, or editing specs, plans, features or architecture documents - and when work failed QA and must be reverted
---

# Hub workflow

## Overview

Every stage of work in this hub has one command that performs it. This skill tells you which. The commands do the git work; you never re-create their steps by hand, because hand-made branches, worktrees, footers and PR text are exactly where traceability breaks.

**Announce at start:** "Using hub-workflow to pick the command for this stage."

The rules behind each command are in `docs/WORKFLOW.md`. Superpowers skills still drive design and execution; this skill only covers the moments around them.

## Pick the stage

| You are about to… | Run (from the hub root) | Then |
|---|---|---|
| Design anything | Classify the tier out loud, then `graphify-preflight` and `superpowers:brainstorming` | Trivial and bounded: the design ends approved in chat, with no spec file and no `writing-plans` |
| Onboard a product repository | `onboard-repository` skill (it runs `pnpm repo:add`, which builds the graph) | A person reviews the drafted map in the hub PR |
| Turn a PRD or large outcome into an epic | `epic-design` skill (it runs `pnpm epic:new <slug> --prd <file>`) | Up to three rounds of questions before writing; then `pnpm epic:pr <slug>` |
| Start a phase of an epic | `pnpm plan:new <slug> --repos <a,b> --epic <epic>` | Link the epic in the spec's `## Links`; criteria name their `REQ-n` |
| Start **trivial** or **bounded** work | `pnpm work:start <repo> <type>/<slug> [--issue <n>]` | Work in the printed worktree; with `--issue`, read the saved issue context first |
| Start **architectural** work | `pnpm plan:new <slug> --repos <a,b> [--issue <n>] [--epic <slug>]` | Save the spec and plans at the printed paths; decline writing-plans' offer to execute |
| Open the spec PR | `pnpm check`, commit `docs(spec): <id> <slug>`, `pnpm plan:pr <id> --spec [--create]` | Ask your human partner before `--create` or any push |
| Execute an approved plan | `pnpm plan:start <id> --repo <name>` | Start the session in the printed worktree |
| Commit a plan task | `git commit -m "<type>(<scope>): <summary>" --trailer "Task: <n>" [--trailer "Refs: <ids>"] [--trailer "Ruling: <decision> — <why> — <cost>"]` | One commit per task; hooks add `Plan:`; every deviation from the plan (decided with your human partner) and every parked review finding is a `Ruling:` footer |
| Record a ruling after the task's commit | `git commit --allow-empty -m "chore(plan): record ruling" --trailer "Task: <n>" --trailer "Ruling: …"` | Never amend: Superpowers' reviews refer to commits by SHA |
| Open a code PR | `superpowers:finishing-a-development-branch` → "Push and create a Pull Request": `pnpm plan:pr <id> --repo <name> --create` in GitHub mode, otherwise its printed text | Never merge locally |
| Open a bounded PR | `pnpm work:pr <repo> <type>/<slug> [--create]` | Sections come from the commit body's `Cause:`/`Rationale:`, `Fix:`, `Verification:` paragraphs; it explains the fix on the issue it came from |
| See progress | `pnpm plan:status [id]` | Never tick plan checkboxes by hand |
| Close planned work after code PRs merged | `pnpm plan:complete <id>` | Apply and tick the printed Documentation impact, `pnpm check`, then `pnpm plan:pr <id> --completion [--create]` |
| Tidy up after the completion PR merged | `pnpm plan:cleanup <id>` | |
| Tidy up after bounded work merged | `pnpm work:cleanup <repo> <type>/<slug>` | |
| Undo merged work that failed QA | `pnpm plan:revert <id>` | It only prints; show the commands and wait for approval |
| Stop planned work nobody will finish | `pnpm plan:abandon <id> --reason "<your partner's reason>"` | Only on your human partner's decision; refuses if code already merged |
| Write or change a pattern | Copy `docs/templates/PATTERN.md` to `docs/patterns/<slug>.md` on a hub branch `docs/pattern-<slug>`; cite it from the maps whose new code must follow it | A person approves the rules in the hub PR |
| Review someone else's pull request | `review-pull-request` skill (it runs `pnpm review:start <repo> <pr>`) | Draft only; your human partner posts. Then `pnpm review:cleanup <repo> <pr>` |
| Something seems misconfigured | `pnpm doctor` | Each ✖ names its fix |

## Rules

- Work on product code only inside `.worktrees/…` created by `work:start` or `plan:start`, never in `repos/<name>` and never in a worktree of the hub.
- Do not invent IDs, branch names or file paths: `plan:new` allocates them and `plan:start` creates the branch.
- Outward actions (push, opening PRs, merging) need your human partner's go-ahead every time.
- If a command refuses, its message says why. Fix the cause; do not work around the command with raw git.

## Red flags

| Thought | Reality |
|---|---|
| "It's faster to `git switch -c` myself" | Hand-made branches skip the fresh fetch and the hook self-test. Use `work:start` or `plan:start`. |
| "I'll tick the boxes so the plan looks current" | `pnpm check` rejects hand-ticked boxes. `plan:status` shows progress. |
| "I'll write the PR description myself" | `plan:pr` and `work:pr` carry the footers the squash commit needs and post the issue comment. Edit the text if needed; keep the footers. |
| "I'll just move the label to pending review" | Labels follow the commands; a hand-set label is overwritten at the next step. Run the step's command. |
| "The task is tiny, it doesn't need a `Task:` footer" | The hook rejects it, and `plan:complete` counts on it. |
| "I'll run the revert commands, QA already failed" | Reverts are outward and destructive. Print, show, wait. |
| "Brainstorming says to write the spec and the plan" (bounded work) | The tier decides. Bounded work ends with an approved design in chat and `work:start`. |
| "writing-plans offers to execute, I'll pick subagent-driven" | Decline. The spec PR merges first; `plan:start` and a new session in its worktree execute it. |
| "The plan is wrong here, I'll decide and move on" | Escalate to your human partner, as Superpowers says; then record their decision as a `Ruling:`. |
| "I'll copy the acceptance criteria into the feature doc now" | Living documents change in the completion PR; `plan:complete` moves them. |
