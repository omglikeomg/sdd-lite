---
type: adr
status: accepted
---
# ADR-0001: The hub holds all specs; product repositories are submodules

## Context

The product is one system split across several repositories (NestJS API, Next.js web, SST infrastructure). Features usually span more than one of them. We want specifications, decisions and plans in one place that people and agents can search, and a single knowledge graph across all code.

Three layouts were considered:

1. **Documents live with their code** in each product repository, with a small hub for cross-repository material.
2. **A monorepo** containing all code and documents, with this method installed as a kit.
3. **A hub repository** holding every document, with the product repositories as git submodules.

## Decision

We use the hub (option 3). Every specification, ADR, plan, feature document and architecture document lives here; product repositories are submodules under `repos/`. Planned work flows through two hub PRs (spec, then completion) around one code PR per product repository.

## Consequences

- One place to read everything, and one Graphify graph over all documents and all code. Hub documents cite code with hub-relative paths, which Graphify links as `EXTRACTED` edges.
- Product repositories stay free of process files; the hub installs its hooks locally only.
- Code and its specification never land in the same commit. The completion PR moves the submodule pointer together with the living documents, so the hub's `main` always describes the code at its pointers, and `pnpm check` verifies acceptance criteria against tests at those pointers.
- Execution must happen in a worktree of the product repository, not of the hub; `pnpm plan:start` creates it.
- Two completion PRs can move the same pointer; the later one rebases and points at the newer commit.

## Alternatives considered

- **Documents with their code** keeps spec and code atomic but scatters cross-repository features and needs one graph per repository.
- **Monorepo** removes every synchronisation step and suits pnpm, Turborepo and SST v3 best, but requires migrating repositories, history and deploy pipelines. The layout under `docs/codebases/` maps one-to-one onto a future `apps/` folder, so this decision can be revisited.

## Links

- [How we work](../WORKFLOW.md)
- [System architecture](../ARCHITECTURE.md)
