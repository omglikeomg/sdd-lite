---
name: graphify-preflight
description: Use when starting brainstorming, design, specification, planning or a bug investigation in the hub, before proposing approaches or asking design questions - gathers existing code, feature specs, ADRs and rationale from the knowledge graph so nothing is reinvented or contradicted
---

# Graphify preflight

## Overview

Design starts from the system that exists. This skill refreshes the knowledge graph, queries it, verifies what it finds by reading the files, and writes a Context block that brainstorming and the design spec build on.

**Announce at start:** "Using graphify-preflight to gather existing context before designing."

It is the "Explore project context" step of `superpowers:brainstorming`. Scale it to the tier: one or two queries for Bounded work, the full checklist for Architectural work.

## Checklist

Create a todo for each item and complete them in order.

1. **Refresh.** From the hub root run `graphify update .`. Paste the last line of its output. If it fails, stop and report it; do not query a stale graph.
2. **Documents pending?** If `graphify-out/needs_update` exists and the work is Architectural, tell your human partner that document changes are not yet in the graph and ask whether to run `/graphify . --update` (it calls an LLM and costs tokens). Continue either way, noting the answer.
3. **Read the maps.** `docs/ARCHITECTURE.md`, the `docs/codebases/<repo>/ARCHITECTURE.md` of every repository the request touches, any area document whose name matches the domain, and every pattern in `docs/patterns/` those documents cite: new code follows them.
4. **Query.** Two to four questions in the request's own words, for example:
   - `graphify query "how are invoices issued"`
   - `graphify explain "BillingService"` for every concrete class, module or route named in the request
   - `graphify path "CheckoutController" "PaymentGateway"` when two parts must be connected
5. **Find the reasons.** For every module the answers touch, look for the documents citing it (incoming `references` edges in `graphify explain`), ADRs listed in `docs/ARCHITECTURE.md` under Evolution, `// WHY:` rationale nodes, and acceptance criteria in `docs/features/`.
6. **Verify.** Open every file you will name in the Context block. `EXTRACTED` edges are facts; `INFERRED` and `AMBIGUOUS` edges are leads until the code confirms them.
7. **Write the Context block** (format below) into the conversation for Bounded work, or into the design spec's `## Context` for Architectural work.

## Context block format

```markdown
## Context

Graph refreshed: `graphify update .` → "Rebuilt: 4,812 nodes, 9,733 edges, 61 communities" (2026-10-08)
Document layer: up to date | pending (human chose to skip the LLM pass)

**Existing code to reuse or extend**
- `repos/api/src/billing/billing.service.ts::BillingService` issues invoices; extend it instead of a new service.

**Patterns to follow**
- `docs/patterns/idempotent-message-handlers.md`: the new consumer records its key in the same transaction as the invoice.

**Constraints**
- ADR-0004 (immutable invoices): refunds create credit notes, never edit an invoice.
- BILL-ISSUE-1 in `docs/features/billing.md` must keep passing.

**High-traffic modules touched**
- `repos/api/src/payments/payments.module.ts` (degree 47): changes here need extra review.

**Open questions for brainstorming**
- Should saved cards live in the payments module or a new wallet module?
```

## Red flags

| Thought | Reality |
|---|---|
| "I know this codebase, I can skip the graph" | The graph exists because memory is wrong. Run the checklist. |
| "The graph says X calls Y" (edge is INFERRED) | Open the file. Inferred edges are guesses until read. |
| "Nothing similar exists" after one query | Ask a second question in different words and check the feature documents. |
| "I'll query without refreshing, it was built recently" | Submodule commits do not refresh the hub's graph. Refresh. |
| "The Context block can list files I have not opened" | Every path in it was read in this session, or it is not in the block. |
