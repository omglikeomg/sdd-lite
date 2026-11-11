---
type: adr
status: accepted
---
# ADR-0004: One living glossary for the whole system

## Context

Nothing in the hub records what its words mean. "Ruling", "door", "frontier" and "living document" are defined in passing across `docs/WORKFLOW.md`, and product terms will arrive with every onboarded repository. An agent and a person can use one word for two things, or two words for one thing, and a design built on that mismatch is wrong before any code is written. A shared vocabulary needs a home, and a new kind of document under `docs/` is a decision ("Where things live").

## Decision

The system has one glossary, `docs/GLOSSARY.md`, for the hub and every product repository.

- Each context (the hub, later each product domain) is a `##` section; each term is a `###` heading under it, holding one definition paragraph of at most two sentences and an optional `_Avoid_:` line naming the words not to use for it.
- It is a living document: it describes `main`. Terms agreed while designing are listed in the work's Documentation impact and written in its completion PR; a missing term for code already on `main` can be added in a small hub PR.
- `pnpm check` enforces the format (rule `glossary`) and rejects email addresses and @-mentions, because entries hold no personal data.
- The `graphify-preflight` skill reads it and surfaces the relevant terms, design conversations challenge words that drift from it, and the `wait-what` skill explains a term on request.

## Consequences

- Terms are graph nodes (Graphify indexes Markdown headings), so `graphify query` finds them and documents can link `GLOSSARY.md#<term>`.
- One file grows with the system. Splitting it into one file per context later is a new decision that supersedes this one.
- A term introduced by unmerged work is not in the glossary until that work completes; until then the design spec or epic carries its definition.
- Names of people cannot be caught by a pattern; reviewers catch them.

## Alternatives considered

- **One glossary per product repository under `docs/codebases/<repo>/`:** a term shared across repositories (a customer, an order) would be defined twice and could drift, which is the problem contracts exist to prevent; and no file could hold real entries until a repository is onboarded.
- **A root `GLOSSARY.md` plus a `GLOSSARY-MAP.md` of contexts, with bold-line entries (Matt Pocock's domain-modeling format):** bold lines are not graph nodes or link targets, and a map file adds a second document before a second context exists.
- **A table of terms:** the same graph blindness, and every edit rewrites a wide row.
- **Updating the glossary inline while designing:** the glossary would describe designs that may never ship, breaking the rule that living documents describe `main`.

## Links

- Glossary: [docs/GLOSSARY.md](../GLOSSARY.md)
- Check: `tools/lib/glossary.mjs::glossaryProblems`
- Supersedes: none
