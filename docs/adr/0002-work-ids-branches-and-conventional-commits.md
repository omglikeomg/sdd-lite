---
type: adr
status: accepted
---
# ADR-0002: Six-digit work IDs in branches and Conventional Commit footers

## Context

Planned work spans a hub spec PR, one code PR per product repository and a hub completion PR. Without an issue tracker, people need one handle to find all of it, and plan progress must be derived from git rather than from an agent remembering to update a file.

## Decision

- Each piece of planned work gets one six-digit ID (`000042`), allocated only by `pnpm plan:new`, shared by its design spec and every per-repository plan.
- Files: `docs/superpowers/specs/<id>-<slug>-design.md` and `docs/superpowers/plans/<id>-<slug>--<repo>.md`, replacing Superpowers' date-based default names.
- Branches: `<type>/<id>-<slug>` in product repositories; `docs/<id>-<slug>-spec` and `docs/<id>-<slug>-completion` in the hub. Bounded work has no ID and uses `<type>/<slug>`.
- Commits follow Conventional Commits. The ID lives in footers, never in the header: `Plan: <id>` (added by a hook from the branch name), `Task: <n>` (required on planned branches), `Refs: <ADR and acceptance-criteria IDs>`.
- Code PRs are squash merged with a Conventional Commit title; the squash body keeps the footers.
- Plan checkboxes are ticked only by `pnpm plan:complete`, from `Task:` footers.

## Consequences

- `git log --grep '^Plan: 000042'` finds the work in every repository, and one squash commit per repository makes a failed feature easy to revert.
- Hooks reject task commits without `Task:`, so progress cannot drift from history.
- Concurrent spec PRs can collide on an ID; `pnpm check` catches it and the later PR renumbers before any product branch uses the ID.
- ADRs keep four-digit numbers because Graphify recognises at most five digits in `ADR-` citations.

## Links

- [Branches and commits](../WORKFLOW.md#branches-and-commits)
- [ADR-0001](0001-hub-with-submodules-holds-all-specs.md)
