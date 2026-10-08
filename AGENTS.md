# Agent rules for this hub

This repository is the hub: specs, decisions and plans for the product repositories checked out under `repos/`. The full contract is `docs/WORKFLOW.md`; read it before your first change. These rules are not optional, and they take precedence over skill defaults.

## Before designing anything

1. Use the Superpowers skills unchanged. Classify every request (Trivial, Bounded, Architectural, Epic) and say the classification out loud. The `hub-workflow` skill maps every stage of the work to its command.
2. Brainstorming's "Explore project context" step is the `graphify-preflight` skill. Never claim knowledge of the code from the graph without running `graphify update .` first in this session.
3. Reuse before building: if the preflight finds a module that does the job, the design extends it or explains in the spec why it cannot.

## Specs and plans (Architectural work)

4. Get the ID and file paths from `pnpm plan:new <slug> --repos <names>`. Save the design spec and plans exactly at the printed paths; never invent an ID or use the date-based default names.
5. Design specs follow `docs/templates/DESIGN-SPEC.md`, including `## Documentation impact`: every living document (architecture maps, contracts, feature documents) the work will change. Plans add the sections in `docs/templates/PLAN-ADDENDUM.md`.
6. Every plan commit step is `git commit -m "<type>(<scope>): <summary>" --trailer "Task: <n>"`, plus `--trailer "Refs: <ids>"` when it implements ADRs or acceptance criteria.
7. Tests that prove an acceptance criterion have a title starting with its ID: `it('CHECKOUT-PAY-1: …')`.
8. Write an ADR only for the triggers in `docs/WORKFLOW.md` ("ADRs"). Never use ADRs as tasks.

## Executing

9. Start planned work only with `pnpm plan:start <id> --repo <name>` and bounded work only with `pnpm work:start <repo> <type>/<slug>`; work inside the worktree they print. Never edit code in `repos/<name>` directly, and never create worktrees of the hub for product work.
10. When execution is done, stop and ask before pushing. After the go-ahead, finish with `superpowers:finishing-a-development-branch` choosing "Push and create a Pull Request", through `pnpm plan:pr <id> --repo <name> --create` in GitHub mode (it pushes and opens the PR) or with the text it prints otherwise. Never merge locally: it deletes the worktree. Record every deviation from the plan as a `Ruling:` footer on the task's commit; the Superpowers ledger is deleted at the end of a run.
11. Do not tick plan checkboxes by hand. `pnpm plan:complete` does it from git history.
12. Add `// WHY: <reason> (ADR-NNNN)` only where the code cannot explain a choice by itself.

## Documents

13. Living documents (`docs/features/`, `docs/codebases/`, `docs/contracts/`, `docs/ARCHITECTURE.md`) must describe the code on `main`. Update them in the completion PR, not before: apply every item of the spec's Documentation impact and tick it; `pnpm plan:complete` moves acceptance criteria for you.
14. Point at code with backticked hub-relative paths such as `` `repos/api/src/billing/billing.module.ts::BillingModule` ``; link documents with relative Markdown links.
15. No placeholder text (`TBD`, `TODO`, `insert here`) in any document.
16. `pnpm check` must pass before any hub commit. If it fails, fix the cause; never bypass hooks with `--no-verify`.

## Branches and commits

17. Conventional Commits everywhere. Branch names: `<type>/<id>-<slug>` for planned work, `<type>/<slug>` for bounded work, `docs/<id>-<slug>-spec` and `docs/<id>-<slug>-completion` in the hub, and `<type>/<slug>` for any other hub change (e.g. `chore/onboard-api`). Hub changes reach `main` through a PR.
18. Ask before pushing, opening pull requests or merging anything; that includes every `--create`. `pnpm plan:revert` only prints commands; never run its output without your human partner's go-ahead.

## GitHub (when `hub.config.json` has GitHub mode on)

19. Change issues, labels and PRs only through the hub's commands; never set `status:*`, `tier:*`, `type:*`, `repo:*`, `epic:*` or `breaking-change` labels by hand. Comments of your own are welcome when work needs explaining.
20. When work starts from an issue, pass it: `plan:new … --issue <n>` for planned work, `work:start … --issue <n>` for a bug. Read the saved issue context before designing.
21. Bounded commits explain themselves in labelled paragraphs (`Cause:` or `Rationale:`, `Fix:`, `Verification:`, optional `Risk:`); `work:pr` turns them into the PR's sections and the issue comment.
22. Run `pnpm plan:abandon` only when your human partner decides the work stops, and pass their reason.

## Epics and onboarding

23. A PRD, product brief or outcome needing several pieces of work goes through the `epic-design` skill before any phase starts; onboarding a repository goes through the `onboard-repository` skill.
24. Phases of an epic start one at a time, with `--epic <slug>`, and their acceptance criteria name the requirements they fulfil (`(REQ-2)`).
