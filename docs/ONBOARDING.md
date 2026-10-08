# Onboarding

This gets you from a fresh laptop to your first merged change in about thirty minutes of reading and setup, plus the change itself. It assumes you know git and TypeScript; it assumes nothing about this project.

## 1. Install the tools (10 minutes)

| Tool | Version | Install |
|---|---|---|
| Node.js | 20 or newer | your usual version manager |
| pnpm | 9 or newer | `corepack enable` |
| git | 2.36 or newer | your package manager |
| Graphify | 0.9.80 or newer | `uv tool install graphifyy` (the package name has two y's) |
| A coding agent | Claude Code or OpenCode | see the agent's own documentation |
| GitHub CLI `gh` | current, logged in (`gh auth login`) | only if the hub has GitHub mode on; see `docs/GITHUB.md` |
| Superpowers | current | in Claude Code: `/plugin install superpowers@claude-plugins-official`; in OpenCode: follow [Superpowers for OpenCode](https://github.com/obra/superpowers/blob/main/docs/README.opencode.md) (the config key differs between OpenCode V1 and V2) |

Then clone the hub with its product repositories and set it up:

```bash
git clone --recurse-submodules <hub-url> hub
cd hub
pnpm hub:setup
pnpm doctor
graphify update .
```

`pnpm hub:setup` checks the versions above, checks out every product repository and installs git hooks. Nothing it installs is committed anywhere. `pnpm doctor` proves it worked; rerun it whenever something feels off.

## 2. Read three documents (15 minutes)

1. `README.md`: what the hub is and the shape of a piece of work.
2. `docs/ARCHITECTURE.md`: the system map. Follow the link to the map of the repository you will work in, and to the contracts it offers or consumes.
3. `docs/WORKFLOW.md`: the rules. Skim it now; you will come back to "Branches and commits" and "What `pnpm check` enforces".

Then read `docs/EXAMPLES.md`: a bug fix, a feature, a new module and an epic, followed step by step on an example product. Afterwards, skim the ADRs listed under "Evolution" in the architecture document. They are short and explain why things are the way they are.

## 3. Ask the graph (5 minutes)

The graph answers "where" and "why" questions faster than searching. From the hub root:

```bash
graphify query "what are the main modules of the api"
graphify query "how does the web app call the api"
graphify explain "AppModule"                 # any class, module or function name
graphify path "CheckoutPage" "PaymentsController"
cat graphify-out/GRAPH_REPORT.md             # most-connected modules and surprising links
```

Every answer cites files and lines. Edges tagged `EXTRACTED` were read from the source; `INFERRED` ones are educated guesses, so open the file before relying on them. `graphify explain` on a class also lists the hub documents that cite it, which is the fastest way to find its specification.

To find out why a line of code exists: `git blame` it in its repository, then read the commit's `Plan:` and `Refs:` footers. `Plan: 000042` leads to `docs/superpowers/specs/` and `docs/superpowers/plans/` files starting with `000042`; `Refs: ADR-0012` leads to `docs/adr/`.

## 4. Make a first change

Pick a Bounded change: a small fix in a flow that already exists. It is also the path we recommend whenever a change fits one repository; `README.md` explains why. With your agent, started from the hub root:

1. Describe the change. The agent classifies it, runs the graph preflight and proposes a short design. Approve it or correct it.
2. Create a worktree of the product repository on a branch from a fresh default branch, and work there. The checkouts under `repos/` stay untouched at the hub's pointers.

   ```bash
   pnpm work:start <repo> fix/<short-slug>
   cd .worktrees/<repo>--<short-slug>
   ```

3. Implement with tests first. Commit with a Conventional Commit, for example `fix(billing): round invoice totals half-up`. The hooks will tell you if the message or branch name is off.
4. Push and open a PR in the product repository. Squash merge it with a Conventional Commit title, then `pnpm work:cleanup <repo> fix/<short-slug>`.
5. If the change altered behaviour described in `docs/features/` or structure described in `docs/codebases/`, open a hub PR updating those documents, and run `pnpm check` first.

If your first Architectural change follows the longer flow in `docs/WORKFLOW.md`; pair with someone who has done one.

## When something blocks you

`docs/TROUBLESHOOTING.md` covers everything; the common cases:

| Symptom | Fix |
|---|---|
| A commit is rejected with `[hub]` messages | The message names the rule; the section "Branches and commits" in `docs/WORKFLOW.md` has examples |
| `pnpm check` fails | Each line is `file:line [rule] message`; the rule names are explained in `docs/WORKFLOW.md` |
| `pnpm plan:start` says the hook self-test failed | Run `pnpm hub:setup` again; for lefthook repositories run `pnpm install` in the repository first |
| A graph answer looks out of date | `graphify update .`, then ask again |
| A product repository folder is empty, or not at the hub's pointer | `git submodule update --init` |
