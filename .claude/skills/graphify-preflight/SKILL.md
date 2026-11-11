---
name: graphify-preflight
description: Use when asked to propose or brainstorm a design, write a specification or plan, or start a bug investigation in the hub or its product repositories, before proposing approaches or asking design questions, even when someone says they know the code or asks to skip it - gathers existing code, feature specs, ADRs and rationale from the knowledge graph so nothing is reinvented or contradicted
---

# Graphify preflight

## Overview

Design starts from the system that exists. This skill refreshes the knowledge graph, queries it, verifies what it finds by reading the files, and writes a Context block that brainstorming and the design spec build on.

**Announce at start:** "Using graphify-preflight to gather existing context before designing."

It is how `superpowers:brainstorming` reads the project before its first message, and it runs every time. Scale it to the tier: one or two queries for Bounded work, the full checklist for Architectural work.

## When NOT to use

- Trivial work: it skips design; state the change in one line and start it (`hub-workflow`).
- Reviewing someone else's pull request: `review-pull-request` refreshes the graph through `pnpm review:start` and maps the impact itself.
- Onboarding a repository: `onboard-repository` reads the graph for the whole repository.

## Checklist

Create a todo for each item and complete them in order.

1. **Refresh.** From the hub root run `GRAPHIFY_NO_TIPS=1 graphify update .` and paste its `[graphify watch]` line: `Rebuilt: … nodes, … edges, … communities`, or `No code-graph topology changes detected` when nothing changed. If it fails, stop and report it; do not query a stale graph.
2. **LLM document layer?** `graphify update .` refreshes code and the structure of every Markdown file for free. If `graphify-out/cost.json` exists, someone ran the optional LLM pass in this clone, and documents that pass read are no longer re-read by `graphify update .`: their later edits are missing from the graph. For Architectural work, tell your human partner and ask whether to run `/graphify . --update` (it calls an LLM and costs tokens; it re-reads only changed files). Continue either way, noting the answer. Without `cost.json` there is nothing to ask.
3. **Read the maps.** `docs/ARCHITECTURE.md`, the `docs/codebases/<repo>/ARCHITECTURE.md` of every repository the request touches, any area document whose name matches the domain, and every pattern in `docs/patterns/` those documents cite: new code follows them.
4. **Query.** Two to four questions in the request's own words, for example:
   - `graphify query "how are invoices issued"`
   - `graphify explain "BillingService"` for every concrete class, module or route named in the request (`graphify explain "repos/api/src/billing/billing.service.ts::issue"` for a method, or when a name exists twice)
   - `graphify path "CheckoutController" "PaymentGateway"` when two parts must be connected
5. **Find the reasons.** For every module the answers touch, look for the documents citing it (`graphify affected "<Symbol>"` lists every importer, caller and citing document; `graphify explain` stops at 20 connections, so on busy modules it hides them), ADRs listed in `docs/ARCHITECTURE.md` under Evolution, `// WHY:` rationale nodes, and acceptance criteria in `docs/features/`. Documents link to code in the graph only through `` `path::Symbol` `` citations; `grep -rn "<file path>" docs/` finds those that cite a bare path.
6. **Verify.** Open every file you will name in the Context block. `EXTRACTED` edges are facts; `INFERRED` and `AMBIGUOUS` edges are leads until the code confirms them.
7. **Write the Context block** (format below) into the conversation for Bounded work, or into the design spec's `## Context` for Architectural work.

## Context block format

```markdown
## Context

Graph refreshed: `graphify update .` → "Rebuilt: 4812 nodes, 9733 edges, 61 communities" (2026-10-08)
Document layer: structure only | LLM layer refreshed | LLM layer stale (human chose not to rerun it)

**Existing code to reuse or extend**
- `repos/api/src/billing/billing.service.ts::BillingService` issues invoices; extend it instead of a new service.

<!-- Only when the repository's map cites patterns; otherwise leave the heading out. -->
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
| "My partner said to skip the graph" | It always runs. Say why in one line, then run it at the size the tier needs. |
| "The graph says X calls Y" (edge is INFERRED) | Open the file. Inferred edges are guesses until read. |
| "Nothing similar exists" after one query | Ask a second question in different words and check the feature documents. |
| "I'll query without refreshing, it was built recently" | Submodule commits do not refresh the hub's graph. Refresh. |
| "The Context block can list files I have not opened" | Every path in it was read in this session, or it is not in the block. |

## Verification

Before you say this skill's work is done:

- [ ] The graph was refreshed in this session — **Evidence:** the pasted `[graphify watch]` line.
- [ ] Every path in the Context block was opened in this session — **Evidence:** a read of each path earlier in the conversation.
- [ ] Every `INFERRED` or `AMBIGUOUS` edge you kept was confirmed in the code — **Evidence:** the file and line that confirms it, next to the claim.
- [ ] The Context block is where the tier puts it — **Evidence:** the block in the conversation (Bounded) or the spec's `## Context` (Architectural).
