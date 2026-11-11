---
name: hub-workflow
description: Use when starting, resuming, handing off or finishing any work in the hub or its product repositories under repos/: a trivial change, a bounded fix, planned or epic work, creating branches, worktrees or commits, opening pull requests, editing specs, plans, features or architecture documents, or reverting work that failed QA - names the hub command for each stage of the work
---

# Hub workflow

## Overview

Every stage of work in this hub has one command that performs it. This skill tells you which. The commands do the git work; you never re-create their steps by hand, because hand-made branches, worktrees, footers and PR text are exactly where traceability breaks.

**Announce at start:** "Using hub-workflow to pick the command for this stage."

The rules behind each command are in `docs/WORKFLOW.md`. Superpowers skills still drive design and execution; this skill only covers the moments around them.

## When NOT to use

- Inside a design: `graphify-preflight` and `superpowers:brainstorming` do the work; come back here before you ask approval of a written spec, and when it is time to start the work.
- Inside a task: Superpowers' execution skills drive the code; come back here for the commit, the PR and the completion.
- Changing the hub itself (its tools, skills or documents): there is no `work:start` or `plan:start` for that; use a `<type>/<slug>` hub branch and a PR, with `pnpm check` and `pnpm test` passing before each commit.

## Pick the stage

| You are about to… | Run (from the hub root) | Then |
|---|---|---|
| Design anything | Classify the tier out loud, then `graphify-preflight` and `superpowers:brainstorming` | Trivial: no brainstorming, one line and `work:start`. Bounded: brainstorming's small change, its short design approved in chat, no spec file and no plan |
| Onboard a product repository | `onboard-repository` skill (it runs `pnpm repo:add`, which builds the graph) | A person reviews the drafted map in the hub PR |
| Turn a PRD or large outcome into an epic | `epic-design` skill (it runs `pnpm epic:new <slug> --prd <file>`) | Up to three rounds of questions before writing; then `pnpm epic:pr <slug>` |
| Start a phase of an epic | `pnpm plan:new <slug> --repos <a,b> --epic <epic>` | Link the epic in the spec's `## Links`; criteria name their `REQ-n` |
| Start **trivial** or **bounded** work | `pnpm work:start <repo> <type>/<slug> [--issue <n>]` | Work in the printed worktree; with `--issue`, read the saved issue context first |
| Start **architectural** work | `pnpm plan:new <slug> --repos <a,b> [--issue <n>] [--epic <slug>]` | Save the spec and plans at the printed paths; decline writing-plans' offer to execute |
| Ask approval of a written design spec (architectural work, epic phases) | After brainstorming's builder check, start a fresh `general-purpose` subagent with `spec-doubt-prompt.md` from this skill's folder: the spec and the constraints its `## Context` cites, none of your reasoning | Sort each finding as a contract misread (fix what you gave it), a fix to the spec, an accepted trade-off (write it in the spec) or noise. Rerun on the changed spec, at most three rounds; bring what is still open to your partner with the approval request |
| Approve a plan's tasks, once writing-plans saved it | Show each plan's task list, one line per task: its title, its `Blocked by:` and its test seam (the task's `Test:` file and the test that proves it) | Wait for your human partner's approval before the spec PR. The list replaces writing-plans' request to review the whole plan |
| Open the spec PR | `pnpm check`, commit `docs(spec): <id> <slug>`, `pnpm plan:pr <id> --spec [--create]` | Ask your human partner before `--create` or any push |
| Execute an approved plan | `pnpm plan:start <id> --repo <name>` | Start the session in the printed worktree |
| Commit a plan task | `git commit -m "<type>(<scope>): <summary>" --trailer "Task: <n>" [--trailer "Refs: <ids>"] [--trailer "Ruling: <decision> — <why> — <cost>"]` | One commit per task; hooks add `Plan:`; every deviation from the plan and every parked review finding is a `Ruling:` footer |
| Record a ruling after the task's commit | `git commit --allow-empty -m "chore(plan): record ruling" --trailer "Task: <n>" --trailer "Ruling: …"` | Never amend: Superpowers' reviews refer to commits by SHA |
| Open a code PR | `superpowers:finishing-a-development-branch` → "Push and create a Pull Request": `pnpm plan:pr <id> --repo <name> --create` in GitHub mode, otherwise its printed text | Never merge locally |
| Commit bounded work | `git commit` in its worktree, the body in labelled paragraphs: `Cause:` (a bug) or `Rationale:`, `Fix:`, `Verification:`, `Door:`, `Blast radius:` | `Door:` starts with `one-way` (a revert cannot cleanly undo it: migration, published contract or event, external side effect) or `two-way` (reverting the squash undoes it). If the diff touches no migration or contract-cited code and your partner has not said which door it is, ask them before committing. `Blast radius:` is what breaks, and for whom, if the change is wrong |
| Open a bounded PR | `pnpm work:pr <repo> <type>/<slug> [--create]` | Sections come from the commit body's labelled paragraphs, with the door and blast radius under Merge danger; it explains the fix on the issue it came from |
| See progress | `pnpm plan:status [id]` | Never tick plan checkboxes by hand |
| Close planned work after code PRs merged | `pnpm plan:complete <id>` | Apply and tick the printed Documentation impact, `pnpm check`, then `pnpm plan:pr <id> --completion [--create]` |
| Tidy up after the completion PR merged | `pnpm plan:cleanup <id>` | |
| Document merged bounded work | `pnpm repo:sync <repo>` on a hub branch, then update `docs/features/` or `docs/codebases/<repo>/` | One hub PR carries the pointer and the documents; `pnpm check` first |
| Tidy up after bounded work merged | `pnpm work:cleanup <repo> <type>/<slug>` | |
| Undo merged work that failed QA | `pnpm plan:revert <id>` | It only prints; show the commands and wait for approval |
| Stop planned work nobody will finish | `pnpm plan:abandon <id> --reason "<your partner's reason>"` | Only on your human partner's decision; refuses if code already merged |
| Write or change a pattern | Copy `docs/templates/PATTERN.md` to `docs/patterns/<slug>.md` on a hub branch `docs/pattern-<slug>`; cite it from the maps whose new code must follow it | A person approves the rules in the hub PR |
| Review someone else's pull request | `review-pull-request` skill (it runs `pnpm review:start <repo> <pr>`) | Draft only; your human partner posts. Then `pnpm review:cleanup <repo> <pr>` |
| Something seems misconfigured | `pnpm hub:doctor` | Each ✖ names its fix |

## Rules

- Work on product code only inside `.worktrees/…` created by `work:start` or `plan:start`, never in `repos/<name>` and never in a worktree of the hub.
- Do not invent IDs, branch names or file paths: `plan:new` allocates them and `plan:start` creates the branch.
- Outward actions (push, opening PRs, merging) need your human partner's go-ahead every time.
- If a command refuses, its message says why. Fix the cause; do not work around the command with raw git.

## Red flags

| Thought | Reality |
|---|---|
| "It's faster to `git switch -c` myself" | Hand-made branches skip the fresh fetch and the hook self-test. Use `work:start` or `plan:start`. |
| "They're busy, I'll skip the task list and open the spec PR" | The list is the plan in one line per task, quick to approve. Show it and wait; the spec PR comes after the approval. |
| "The builder check was clean and they're ready to approve" | The builder check asks what is missing, not what is wrong. Run the adversarial check, then ask. |
| "I'll give the doubt subagent my reasoning so it has context" | Your reasoning makes it agree with you. Give it the spec and the constraints only. |
| "I'll tick the boxes so the plan looks current" | `pnpm check` rejects hand-ticked boxes. `plan:status` shows progress. |
| "I'll write the PR description myself" | `plan:pr` and `work:pr` carry the footers the squash commit needs and post the issue comment. Edit the text if needed; keep the footers. |
| "I'll just move the label to pending review" | Labels follow the commands; a hand-set label is overwritten at the next step. Run the step's command. |
| "The task is tiny, it doesn't need a `Task:` footer" | The hook rejects it, and `plan:complete` counts on it. |
| "I'll run the revert commands, QA already failed" | Reverts are outward and destructive. Print, show, wait. |
| "writing-plans offers to execute, I'll pick subagent-driven" | Decline. The spec PR merges first; `plan:start` and a new session in its worktree execute it. |
| "The ruling is in the ledger, that's enough" | Superpowers deletes the ledger when the final review is clean. Every ruling goes in a `Ruling:` footer. |
| "I'll copy the acceptance criteria into the feature doc now" | Living documents change in the completion PR; `plan:complete` moves them. |

## Verification

Before you say this skill's work is done:

- [ ] Each stage ran through its hub command — **Evidence:** the command and its output in the conversation; no hand-made branch, worktree, footer or PR text.
- [ ] Product code changed only in a `.worktrees/…` worktree — **Evidence:** `git -C repos/<name> status --short` prints nothing.
- [ ] Every outward action had its own go-ahead — **Evidence:** your partner's message right before each push, `--create` or GitHub write.
- [ ] `pnpm check` passed before each hub commit — **Evidence:** its passing output, run after the last edit and before the commit.
