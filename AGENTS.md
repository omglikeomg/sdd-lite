# Agent rules for this hub

This repository is the hub: specs, decisions and plans for the product repositories checked out under `repos/`. The full contract is `docs/WORKFLOW.md`, and `docs/EXAMPLES.md` shows it in practice; read them before your first change. These rules are not optional, and they take precedence over skill defaults.

## Always

1. Use the Superpowers skills unchanged. Your human partner speaks in plain words; the `hub-workflow` skill maps each stage of the work to the hub command that performs it. Never recreate a command's steps by hand.
2. Ask before anything leaves this machine: pushing, opening or merging pull requests, every `--create`, every GitHub write. A go-ahead covers the action it was given for, not the next one.
3. `pnpm check` must pass before any hub commit. Fix the cause of a failure; never bypass hooks with `--no-verify`. If you believe a check itself is wrong, stop and explain why instead of working around it.
4. No placeholder text (`TBD`, `TODO`, `insert here`) in any document.

## Before designing

5. Classify every request (Trivial, Bounded, Architectural, Epic) and say the classification out loud. When in doubt, the heavier tier. Superpowers does not classify; the tier decides which of its steps run. For trivial and bounded work, brainstorming ends when your human partner approves the design in chat: write no spec file and do not invoke `superpowers:writing-plans`.
6. Brainstorming's "Explore project context" step is the `graphify-preflight` skill. Never claim knowledge of the code from the graph without running `graphify update .` first in this session.
7. Reuse before building: if the preflight finds a module that does the job, the design extends it or explains in the spec why it cannot. New code follows the patterns its repository's map cites (`docs/patterns/`); a design that departs from one says why in the spec.
8. A PRD, product brief or outcome needing several pieces of work goes through the `epic-design` skill before any phase starts. Onboarding a repository goes through the `onboard-repository` skill, and reviewing someone else's pull request through the `review-pull-request` skill.
9. When work starts from an issue, pass it: `plan:new … --issue <n>` for planned work, `work:start … --issue <n>` for a bug. Read the saved issue context before designing.

## Specifying (architectural work and epic phases)

10. Get the ID and file paths from `pnpm plan:new <slug> --repos <names>` (add `--epic <slug>` for a phase of an epic). Save the design spec and plans exactly at the printed paths; never invent an ID or use the date-based default names.
11. Design specs follow `docs/templates/DESIGN-SPEC.md`: acceptance criteria in EARS with bold IDs (criteria of an epic phase name their requirement, like `(REQ-2)`; criteria the work retires go under `### Removed` with the reason), and `## Documentation impact` listing every living document the work will change. Set `status: approved` only when your human partner approves the written spec.
12. Plans add the sections in `docs/templates/PLAN-ADDENDUM.md`. Every commit step is `git commit -m "<type>(<scope>): <summary>" --trailer "Task: <n>"`, plus `--trailer "Refs: <ids>"` when it implements ADRs or acceptance criteria. When writing-plans offers to execute the plan, decline: execution starts with `plan:start` after the spec PR merges, in a new session.
13. Write an ADR only for the triggers in `docs/WORKFLOW.md` ("ADRs"). Never use ADRs as tasks. An accepted ADR is listed under "Evolution" in `docs/ARCHITECTURE.md` in the same PR.

## Executing

14. Trivial and bounded work start with `pnpm work:start <repo> <type>/<slug>`; planned work with `pnpm plan:start <id> --repo <name>`, after which your human partner starts the execution session in the worktree it prints. Work only inside those worktrees: never edit code in `repos/<name>` directly, and never create worktrees of the hub for product work. The command already installed dependencies with the repository's own package manager, so skip the `npm install` of `superpowers:using-git-worktrees`.
15. Tests that prove an acceptance criterion have a title starting with its ID: `it('CHECKOUT-PAY-1: …')`, or `it.each(rows)('CHECKOUT-PAY-1: %s …')`.
16. When the plan is wrong, escalate to your human partner as Superpowers says, then record the decision, and every reviewer finding you park, as a `Ruling: <decision> — <why> — <cost if wrong>` footer on the commit of the task it concerns. If that commit already exists, add an empty one (`git commit --allow-empty -m "chore(plan): record ruling" --trailer "Task: <n>" --trailer "Ruling: …"`); never amend. Superpowers deletes its ledger when a run finishes cleanly; the footers are the record.
17. Bounded commits explain themselves in labelled paragraphs (`Cause:` or `Rationale:`, `Fix:`, `Verification:`, optional `Risk:`); `work:pr` turns them into the PR's sections and the issue comment.
18. Add `// WHY: <reason> (ADR-NNNN)` only where the code cannot explain a choice by itself.
19. When execution is done, stop and ask. After the go-ahead, finish with `superpowers:finishing-a-development-branch` choosing "Push and create a Pull Request", through `pnpm plan:pr <id> --repo <name> --create` or `pnpm work:pr <repo> <branch> --create` in GitHub mode, or with the text they print otherwise. Never merge locally or discard there: both delete the worktree. Work that stops goes through `pnpm plan:abandon` or `pnpm work:cleanup`.

## Completing

20. Do not tick plan checkboxes by hand; `pnpm plan:complete` does it from git history, moves the acceptance criteria and records the rulings.
21. Living documents (`docs/features/`, `docs/codebases/`, `docs/contracts/`, `docs/ARCHITECTURE.md`) describe the code on `main`. Update them in the completion PR, not before: apply every item of the spec's Documentation impact and tick it. For bounded work, the hub PR that updates them also moves the repository's submodule pointer to the merged code.
22. Point at code with backticked hub-relative paths with a symbol, such as `` `repos/api/src/billing/billing.module.ts::BillingModule` ``: only the symbol form becomes a graph edge. Link documents with relative Markdown links.
23. `pnpm plan:revert` only prints commands; never run its output without your human partner's go-ahead. Run `pnpm plan:abandon` only when your human partner decides the work stops, and pass their reason.

## Branches, commits and GitHub

24. Conventional Commits everywhere. Branch names: `<type>/<id>-<slug>` for planned work, `<type>/<slug>` for bounded work, `docs/<id>-<slug>-spec`, `docs/<id>-<slug>-completion` and `docs/epic-<slug>` in the hub, and `<type>/<slug>` for any other hub change (e.g. `chore/onboard-api`). Hub changes reach `main` through a PR.
25. When GitHub mode is on, change issues, labels and PRs only through the hub's commands; never set `status:*`, `tier:*`, `type:*`, `repo:*`, `epic:*` or `breaking-change` labels by hand. Comments of your own are welcome when work needs explaining.
