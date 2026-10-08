---
type: adr
status: accepted
---
# ADR-0003: The knowledge graph is derived and never committed

## Context

Graphify builds `graphify-out/graph.json` from the hub's documents and the checked-out product repositories. Committing it would let teammates query without building, but every branch would rewrite it, PRs would conflict on it, and the LLM-assisted document layer is neither free nor reproducible. Commits inside submodules do not trigger the hub's git hooks, so a hook-maintained graph would go stale silently.

## Decision

- `graphify-out/` is ignored and never committed. Each clone builds its own graph.
- The graph is refreshed with `graphify update .` (no LLM, seconds) at fixed points: the design preflight, `pnpm plan:start` and `pnpm plan:complete`. Freshness is not tracked; it is re-established whenever it matters.
- The LLM pass over documents runs only on request, before architectural design, when Graphify reports pending document changes.
- Merges are gated on the sources the graph reads (`pnpm check`), not on the graph itself.
- Graphify 0.9.80 or newer is required: earlier versions do not link backticked code paths in Markdown to code.

## Consequences

- No graph merge conflicts, and no false confidence from a committed graph that lags the code.
- A new clone needs one `graphify update .` before its first query; `pnpm plan:start` does it.
- Queries reflect the submodules as checked out, which is the code the hub's documents describe.

## Links

- [The knowledge graph](../WORKFLOW.md#the-knowledge-graph)
- [ADR-0001](0001-hub-with-submodules-holds-all-specs.md)
