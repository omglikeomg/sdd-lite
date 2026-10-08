# System architecture

This is the map of the whole system: the hub itself, the product repositories it tracks, and how the architecture has evolved. Each product repository has its own, more detailed map under `docs/codebases/`.

## The hub

The hub holds no product code. It holds what explains the code: specifications, decisions, plans and architecture, plus the tools that keep them consistent with the code.

```mermaid
flowchart LR
  subgraph hub
    docs[docs/]
    tools[tools/]
    graph[(graphify-out/)]
  end
  repos[repos/* submodules]
  docs -- cites code by path --> repos
  tools -- checks docs against --> repos
  graph -- indexes --> docs
  graph -- indexes --> repos
```

| Part | Responsibility |
|---|---|
| `docs/` | Living documents and records; see `docs/WORKFLOW.md` for the layout |
| `tools/docs-check.mjs` | Every rule behind `pnpm check` |
| `tools/plan.mjs` | `plan:*` (new, start, status, complete, pr, cleanup, revert) and `work:*` (start, cleanup) |
| `tools/doctor.mjs` | `doctor`: read-only health check of a clone |
| `tools/gh-setup.mjs` | `gh:setup`: turns GitHub mode on and creates labels |
| `tools/lib/github.mjs` | Every GitHub call, through the `gh` CLI; the label catalogue |
| `tools/lib/issue-text.mjs` | The wording of tracking issues and comments, written for non-engineers |
| `tools/lib/pr-text.mjs` | The structure of code and fix PRs |
| `.github/workflows/check.yml` | CI: `pnpm check` and `pnpm test` on hub PRs and `main` |
| `.github/pull_request_template.md` | Template for hub PRs written by hand |
| `.github/ISSUE_TEMPLATE/` | Feature request and bug report forms for product managers |
| `tools/repo.mjs` | `repo:add`: onboards a product repository as a submodule |
| `tools/setup.mjs` | `hub:setup`: prerequisites, submodules, hook installation |
| `tools/git-hooks/run.mjs` | The single entry point every installed git hook calls |
| `tools/lib/` | Conventions, Markdown, git, hook and acceptance-criteria helpers shared by the tools |
| `tools/test/` | Unit tests and an end-to-end test of the full planned-work cycle |
| `hub.config.json` | Product repositories: path, default branch, test globs, structural files to document |
| `.claude/skills/graphify-preflight/SKILL.md` | The context-gathering step every design starts with |
| `.claude/skills/hub-workflow/SKILL.md` | Maps each stage of the work to the command that performs it |

The tools are plain Node.js modules with no dependencies, so the hub needs nothing installed beyond Node, git and Graphify.

### Invariants

- The hub's `main` describes the code at its submodule pointers. A completion PR moves a pointer only together with the documents that describe the new code.
- `graphify-out/` is derived and never committed; any clone rebuilds it with `graphify update .`.
- Nothing is committed into product repositories by the hub's tooling.

## Product repositories

| Repository | Map | Deploys |
|---|---|---|

No product repositories are onboarded yet. `pnpm repo:add` adds one as a submodule under `repos/`; the person onboarding it adds a row here linking its map in `docs/codebases/`, and `pnpm check` fails until that row exists.

## How the repositories interact

Contracts between repositories (HTTP APIs, events, shared SST stages and resources) are described here as repositories are onboarded, each with the backticked paths of the code that defines both sides.

## Evolution

Accepted decisions in the order they were made. `pnpm check` fails if an accepted ADR is missing from this list.

1. [ADR-0001: The hub holds all specs; product repositories are submodules](adr/0001-hub-with-submodules-holds-all-specs.md)
2. [ADR-0002: Six-digit work IDs in branches and Conventional Commit footers](adr/0002-work-ids-branches-and-conventional-commits.md)
3. [ADR-0003: The knowledge graph is derived and never committed](adr/0003-knowledge-graph-is-derived-and-uncommitted.md)
