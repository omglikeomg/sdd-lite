# Troubleshooting

Problems you can run into with the hub, why they happen, and how to get out. Most were met for real while piloting the hub on two product repositories.

Three commands tell you where you stand; run them first:

```bash
pnpm doctor        # is this clone set up? (tools, hooks, submodules, gh account)
pnpm plan:status   # where is each piece of work?
pnpm check         # do the documents agree with the code?
```

## Setup

| Symptom | Why | Fix |
|---|---|---|
| `pnpm setup` does something unrelated to the hub | `setup` is a built-in pnpm command | The hub's command is `pnpm hub:setup` |
| "graphify … 0.9.80 or newer is required" | Older Graphify does not link documents to code | `uv tool upgrade graphifyy` (the package has two y's) |
| `graphify: command not found` | uv's tool directory is not on `PATH` | `uv tool update-shell`, then open a new terminal |
| "git 2.36 or newer is required" | The hook self-test uses `git hook run` | Upgrade git |
| `pnpm doctor` shows ✖ for a repository's hooks | Hooks were never installed in this clone, or something replaced them | `pnpm hub:setup`. For a repository using lefthook, run its `npm install` / `pnpm install` first so the lefthook binary exists |
| A hook you already had stopped running | `hub:setup` keeps it as `<hook>.local` and runs it first; if it is gone, it was never executable | `chmod +x .git/hooks/<hook>.local` in that repository (the hooks folder is printed by `git rev-parse --git-path hooks`) |

## Submodules

The hub records, for each product repository, the commit its documents describe. `repos/<name>` must be checked out at exactly that commit.

| Symptom | Why | Fix |
|---|---|---|
| `repos/<name>` is empty | Cloned without `--recurse-submodules` | `git submodule update --init` |
| `pnpm check`: "repos/x is checked out at … but the hub points at …" | A pull, merge or branch switch moved the pointer but not the checkout (or the other way round) | `git submodule update`. If you meant to move the pointer, `git add repos/x` instead |
| `repos/<name>` vanished after switching hub branches | The branch you switched to predates the submodule; git removed it, and switching back does not restore it | `git submodule update --init` |
| `git push` in the hub: "The following submodule paths contain changes that can not be found on any remote" | `hub:setup` sets `push.recurseSubmodules=check`: the pointer names a product commit that is not on its remote, so nobody else could check it out | Push that commit's branch in the product repository first, or point back at a published commit (`git -C repos/x checkout origin/main && git add repos/x`) |
| You committed product work directly in `repos/<name>` | That checkout is a detached HEAD at the hub's pointer; work belongs in a worktree | Save it: `git -C repos/x branch rescue/<slug> HEAD`, put the checkout back with `git submodule update`, then `pnpm work:start x fix/<slug>` and `git cherry-pick` the rescued commits there |

## IDs, branches and commits

| Symptom | Why | Fix |
|---|---|---|
| Commit rejected: "not a Conventional Commit" | Every repository uses `<type>(<scope>)!: <summary>` | Reword the summary; types are listed in `docs/WORKFLOW.md` |
| Commit rejected: needs a "Task: <n>" footer | On a planned branch every commit names the plan task it completes | `git commit … --trailer "Task: 3"` (or `"Task: 3, 4"`) |
| Commit rejected: "Task N does not exist in the plan" | The plan on the hub's `main` has no such task | Check the plan; if the plan is wrong, record the deviation as a `Ruling:` footer on a valid task |
| Commit rejected: "Refs: X is not defined" | Acceptance-criteria IDs are read from the hub; new ones exist only once the spec PR is merged | Merge the spec PR first (this is why `plan:start` requires it), or fix the typo |
| Branch name rejected | Planned work uses `<type>/<6-digit id>-<slug>`, bounded work `<type>/<slug>` | Let `plan:start` / `work:start` create branches; to rename one, `git branch -m <new>` |
| `pre-push` rejects a commit made with `--no-verify` | The push hook checks every commit of a planned branch | Last commit: `git commit --amend --no-edit --trailer "Task: 3"`. Older commits: `git rebase -i origin/main`, mark them `reword`, add the footer |
| You need to record a decision after the last commit was pushed | Rulings travel as commit footers | `git commit --allow-empty -m "chore: record ruling" --trailer "Task: <last task>" --trailer "Ruling: <decision> — <why> — <cost>"`; the squash merge folds it in |
| Two spec PRs got the same ID (local mode) | Both allocated before either merged | `pnpm check` fails on the second after it rebases: run `pnpm plan:new` again for it and rename its files to the new ID |
| `plan:new` failed after creating a GitHub issue | The issue exists, the branch does not | Rerun with `--issue <number>` as the error says; no second issue is created |

## Executing plans

| Symptom | Why | Fix |
|---|---|---|
| `plan:start`: "merge the spec PR first" | Execution starts only from an approved, merged design | Merge the spec PR, then rerun |
| `plan:start` / `work:start`: dependency install failed | The worktree runs `npm ci` / `pnpm install --frozen-lockfile` from the repository's own lockfile | Fix the lockfile in the product repository, or rerun with `--no-install` and install by hand |
| The worktree already exists | You (or a previous session) started it before | Rerunning `plan:start` resumes it and reruns the hook self-test |
| The agent chose "merge locally" when finishing | Superpowers then merges into the local `main` and deletes the worktree | The work is on the local branch and in local `main`: push the branch, open the PR, then reset local `main` with `git -C repos/x branch -f main origin/main` (only while that `main` is not checked out anywhere) |
| No rulings in the Completion section | Superpowers deletes its ledger when a run finishes; rulings survive only as `Ruling:` footers | Nothing is lost if the agent followed the plan's execution rules; otherwise record them by hand in the completion PR |
| A session started in `.worktrees/…` ignores the hub's rules (OpenCode) | OpenCode does not look for skills above a git worktree | Expected: execution rules travel inside the plan. Claude Code reads the hub's `CLAUDE.md` from the parent folder |

## Completing work

| Symptom | Why | Fix |
|---|---|---|
| `plan:complete`: "no commit with Plan: <id>" | The code PR is not merged yet, or its squash message lost the footers (edited by hand, or a "title only" squash setting) | Merge it; if it is merged, `pnpm plan:complete <id> --merged <repo>=<squash sha>` |
| `plan:complete`: tasks without a `Task:` footer | A task was not done, or its commit lacked the footer | Finish it, or `--defer <n,…>` to record it as deferred (the tracking issue then gets `status:needs-manual-steps`) |
| `pnpm check` after completion: a structural file is not documented | New NestJS modules, handlers, routers… must appear in the repository's architecture docs | Add the backticked path to `docs/codebases/<repo>/ARCHITECTURE.md` or an area doc's `paths` |
| `pnpm check`: "X has no test whose title starts with X:" | A criterion moved into `docs/features/` has no test titled with its ID | Rename the test to start with `X:` (table tests count: `it.each(rows)('X: %s …')`), or remove the criterion if the behaviour did not ship |
| Onboarding: "test cites X, which no feature or design spec defines" | The repository's tests carry acceptance-criteria IDs from an earlier process | Port the original criteria into `docs/features/` as they were written (preferred). If the source is lost, rebuild them from the test titles and say so in the commit message |
| `pnpm check`: "the work is done but this documentation item is not ticked" | The spec's Documentation impact was not applied | Update the named document, then tick the item in the spec |
| `pnpm check`: "approved specs need a Documentation impact section" | The spec predates the rule or skipped it | Add the section; `- None: <why>` if nothing changes |
| Two completion PRs conflict on `repos/x` | Both moved the same pointer | Rebase the later one, `git -C repos/x checkout origin/main`, `git add repos/x`, `pnpm check` |
| QA fails after release | The work must be undone | `pnpm plan:revert <id>` prints the commands; it finds commits by footer and by the plan's Completion record |
| Planned work should stop | Priorities changed or the design was wrong | `pnpm plan:abandon <id> --reason "…"`; it refuses once code has merged, because shipped work is reverted, not abandoned |
| A fix PR has only a "What changed" section | The commit body had no labelled paragraphs | Amend the commit body with `Cause:` / `Rationale:`, `Fix:`, `Verification:` paragraphs, then rerun `pnpm work:pr` (with `--create`, the open PR is reused; edit its text on GitHub to match) |

## Epics and contracts

| Symptom | Why | Fix |
|---|---|---|
| `pnpm check`: "REQ-n from the PRD is not in the requirement map" | A requirement is unaccounted for | Map it to a phase, a spike, or "Out of scope" with the reason |
| `pnpm check`: "REQ-n is not defined in the epic's prd.md" | A spec or the map cites a requirement the PRD does not have | Fix the ID, or add the requirement to `prd.md` in a PR the PM approves |
| `pnpm check`: "the epic is done but phase … links no design spec" | A phase never started | Start it, or mark it out of scope in the requirement map and remove the row |
| `plan:new --epic`: "no epic docs/epics/<slug>/README.md" | The epic is not on this branch yet | Merge the epic PR first, then start phases from `main` |
| GitHub refused to make the phase a sub-issue | Sub-issues are unavailable for that repository or plan | Nothing breaks: the `epic:<slug>` label still groups them on the board |
| `pnpm check`: "cite the code that implements this contract in <repo>" | A contract names a repository without pointing at its code | Add a backticked `repos/<repo>/…` path for that side |

## GitHub mode

| Symptom | Why | Fix |
|---|---|---|
| "gh is not logged in" | GitHub mode refuses to half-run | `gh auth login` |
| Commands act as the wrong GitHub account | `gh` can hold several accounts; only one is active | `pnpm doctor` shows the active one; `gh auth switch --user <account>` |
| "could not add label … not found" | Labels were never created, or a repository/epic is new | `pnpm gh:setup` (creates or updates, never deletes) |
| A `--create` failed halfway | The PR may exist without its issue comment | Rerun the same command: it reuses the open PR and skips comments already posted |
| `gh issue list` misses an issue you just created | GitHub's search index lags a few seconds | Use the number from the creation output, or wait and retry |
| Merging a PR did not close the issue | Closing keywords only act when merging into the default branch, and need permission on the issue's repository | Close it by hand with a comment linking the PR |
| A label you set by hand changed back | Command-owned labels follow the commands | Run the step's command instead; human-owned labels (`priority:*`, `blocked`, `needs-info`) are never touched |
| Branches and PRs are visible to everyone | Product repositories may be public; only the hub's issues are in the hub repository | Keep sensitive discussion in hub issues; nothing in plan PR bodies is secret by design |

## Continuous integration

| Symptom | Why | Fix |
|---|---|---|
| CI fails cloning submodules: "could not read Username" or "Repository not found" | A product repository is private | Add the `HUB_REPOS_TOKEN` secret (`docs/GITHUB.md`, "Continuous integration") |
| CI fails with `[repos] … is not checked out` | The submodule step was skipped or failed | Read that step's log; `.gitmodules` must list every repository in `hub.config.json` |
| CI passes locally failing checks, or the other way round | Your checkouts are not at the hub's pointers | `git submodule update`, then `pnpm check` again |

## The knowledge graph

| Symptom | Why | Fix |
|---|---|---|
| An answer misses code you just merged | The graph is refreshed at fixed points, not continuously | `graphify update .` from the hub root |
| `graphify-out/needs_update` exists | Documents changed; their LLM-extracted layer is stale | Before architectural design, ask whether to run `/graphify . --update` in your agent (it costs tokens) |
| Graph answers include code from an unmerged branch | A submodule checkout is not at the hub's pointer | `git submodule update`, then `graphify update .` |
