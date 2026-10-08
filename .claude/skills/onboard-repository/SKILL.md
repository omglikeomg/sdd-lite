---
name: onboard-repository
description: Use when a product repository is added to the hub or someone asks to onboard one - drafts its architecture map from the knowledge graph and the code, for a person to review in a hub PR
---

# Onboard a repository

## Overview

A repository joins the hub when its architecture map exists and `pnpm check` passes. You draft the map; a person reviews it, because intent, ownership and deployment are often not in the code.

**Announce at start:** "Using onboard-repository to draft the architecture map for <repo>."

## Checklist

Create a todo for each item and complete them in order.

1. **Add it** (skip if already in `hub.config.json`): ask your human partner for the git URL and presets, then `pnpm repo:add <name> <url> --preset <nest,next,sst,cqrs>`. It installs hooks and builds the knowledge graph.
2. **Branch:** `git switch -c chore/onboard-<name>` in the hub.
3. **Refresh and read the graph:** `graphify update .` (paste its last line), then `graphify-out/GRAPH_REPORT.md` for the most-connected modules and communities in `repos/<name>/`.
4. **Query it:** `graphify query "what are the main modules of <name>"`, `graphify query "how does <name> start and what does it deploy"`, and `graphify explain "<Module>"` for each module that matters. Open every file you will cite.
5. **Read what the repository says about itself:** README, package manifest, entry points, deployment configuration.
6. **Write `docs/codebases/<name>/ARCHITECTURE.md`** from `docs/templates/REPO-ARCHITECTURE.md`: purpose, deployables, modules (every file matched by the repository's `mustDocument` globs, by backticked path), cross-cutting concerns, invariants. Write what the code shows; mark nothing as intended that you only inferred.
7. **Interfaces with other repositories:** if it offers or consumes an API another configured repository uses, write or extend `docs/contracts/<name>.md` from `docs/templates/CONTRACT.md`, citing code on both sides.
8. **Link it** from "Product repositories" (and contracts from "How the repositories interact") in `docs/ARCHITECTURE.md`.
9. **`pnpm check`** until it passes. If the repository's tests already cite acceptance-criteria IDs the hub does not define, ask your human partner for the original specification and port its criteria into `docs/features/` as written; rebuild them from test titles only if the source is lost, and say so.
10. **Hand over:** commit `chore(repos): onboard <name>` and, after your human partner's go-ahead, push and open the PR. In your summary list what you could not tell from the code (owners, deployment, planned changes) and anything surprising (dead code, missing auth, schema ahead of the code).

## Red flags

| Thought | Reality |
|---|---|
| "I'll describe the architecture from the README" | READMEs drift. The graph and the code are the evidence; the README is a lead. |
| "This module looks unused, I'll leave it out" | If it matches `mustDocument`, the check needs it. Say it looks unused. |
| "I know how NestJS apps are usually structured" | Describe this one. Generic structure is not documentation. |
