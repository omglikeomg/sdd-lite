# Worked examples

This document follows one small product through four pieces of work, from the first message to the last merge. Read it once end to end before your first change; afterwards, jump to the example that looks like the work in front of you.

The product, the people and the numbers are invented. The commands, the files they create, the checks and the GitHub behaviour are the hub's real ones; command output is shortened where it is long.

| Example | What happens | Tier | Repositories | Pull requests | Typical agent cost |
|---|---|---|---|---|---|
| [1. A bug fix](#example-1-a-bug-fix) | Editing a note's title erases its body | Bounded | api | 1 | about $0.50 |
| [2. Bulk editing](#example-2-bulk-editing) | Select several notes, change them at once | Architectural | api, web | 4 | about $8–12 |
| [3. An export worker](#example-3-an-asynchronous-export-worker) | Export notes to CSV in the background through SQS | Architectural, with an ADR | api | 3 | about $6–10 |
| [4. Users and login](#example-4-the-users-and-login-epic) | Accounts, sign-in, private notes | Epic of four phases | api, web | 1 + 3–4 per phase | about $5 for the epic design, then per phase |

## The cast and the system

- **Lucía**, a backend engineer, and **Marco**, a frontend engineer. They talk to their agent (Claude Code with Superpowers) in plain words.
- **Irene**, the product manager. She writes issues and PRDs on GitHub and reviews what the hub posts there.
- **The agent**. It runs the hub's commands, writes specs, plans and code, and asks before anything leaves the laptop.

Two product repositories, plus the hub:

| Repository | What it is | In the hub as |
|---|---|---|
| `acme/notes-web` | Next.js app: a list of notes, a note editor, a page per note | `repos/web` |
| `acme/notes-api` | NestJS API on PostgreSQL (Prisma). Hexagonal: `domain/` (aggregates, value objects), `application/` (CQRS command and query handlers), `infrastructure/` (Prisma repositories, HTTP controllers) | `repos/api` |
| `acme/notes-hub` | This hub, with GitHub mode on | the hub |

The notes API today:

```
apps/api/src/
  notes/
    domain/note.aggregate.ts            Note: id, title, body, tags, archived
    application/commands/update-note/   UpdateNoteCommand + handler
    application/queries/list-notes/     ListNotesQuery + handler
    infrastructure/prisma-note.repository.ts
    infrastructure/notes.controller.ts  REST: GET/POST /notes, GET/PATCH/DELETE /notes/:id
  notes.module.ts
```

## The setup, once

Lucía clones the hub and sets it up (`docs/ONBOARDING.md` has the details):

```bash
git clone --recurse-submodules git@github.com:acme/notes-hub.git && cd notes-hub
pnpm hub:setup && pnpm doctor
```

The repositories were onboarded by asking the agent:

> **Lucía:** Onboard our API: git@github.com:acme/notes-api.git. It's NestJS with CQRS handlers.

The agent runs the `onboard-repository` skill:

```
$ pnpm repo:add api git@github.com:acme/notes-api.git --preset nest,cqrs
[repo] added repos/api (main); hooks: plain git hooks
[repo] knowledge graph built with repos/api in it (graphify update .)
[repo] next: ask your agent to "onboard api". Its onboard-repository skill drafts
  docs/codebases/api/ARCHITECTURE.md from the graph, …
```

It reads `graphify-out/GRAPH_REPORT.md`, queries the graph ("what are the main modules of api", `graphify explain "NotesModule"`), opens the files it will cite, and writes `docs/codebases/api/ARCHITECTURE.md`: what the API is, the hexagonal layering, every `*.module.ts` and `*.handler.ts` by path (the `nest` and `cqrs` presets require it), invariants such as "controllers never call Prisma directly". After `web` is onboarded the same way, it writes the first contract, `docs/contracts/notes-rest.md` (`provider: api`, `consumers: [web]`), citing the controller in `api` and the API client in `web`. It ends with a list of what the code could not tell it ("who owns notes-web?", "how is it deployed?"), opens a hub PR on `chore/onboard-api`, and Lucía reviews it like any other PR.

Finally, GitHub mode:

```
$ pnpm gh:setup
[gh] GitHub mode on; tracking issues live in acme/notes-hub
[gh] 23 labels created or updated in acme/notes-hub
```

From here on, every example runs on this setup.

---

## Example 1: A bug fix

**Irene opens a bug report** in `acme/notes-hub` with the bug form (it adds `kind:bug` itself):

> **#12 Editing a note's title erases its body**
> What happened: I renamed "Groceries" to "Groceries (Saturday)" and the list inside was gone.
> What should have happened: only the title changes.
> Impact: customers lose data; there is no workaround.

### 1. Picking it up

> **Lucía:** Please pick up #12.

The agent (`hub-workflow` skill) classifies: *"This is a bug in an existing flow in one repository: Bounded. I'll start from systematic debugging."* It runs `superpowers:systematic-debugging`, then a short `graphify-preflight`: `graphify explain "UpdateNoteHandler"` shows the handler, the controller that calls it and the `NOTES-EDIT-*` criteria in `docs/features/notes.md` that cover editing.

It finds the cause before proposing anything: `PATCH /notes/:id` builds an `UpdateNoteCommand` from the request body, and the handler assigns every field of the command to the aggregate, so fields the client did not send become `undefined`, which Prisma writes as `NULL`.

It proposes a design in chat and stops:

> Fix: make the command carry only the fields that were sent (a partial update), and let `Note.update()` change only those. Add a test that a title-only PATCH keeps the body. One repository, no interface change. OK?

> **Lucía:** Yes.

### 2. The worktree and the fix

```
$ pnpm work:start api fix/partial-note-update --issue 12
[plan] created .worktrees/api--partial-note-update on fix/partial-note-update from fresh origin/main
[plan] installing dependencies (npm ci)
[plan] hook self-test passed (bad commit rejected, valid commit accepted)
  Work in the worktree: cd .worktrees/api--partial-note-update
  The issue and its comments, as context: .worktrees/api--partial-note-update.issue.md
```

On GitHub, #12 now has `tier:bounded`, `repo:api`, `status:ongoing` and a "Work started" comment naming the repository and the branch.

The behaviour deserves a criterion that did not exist yet, so the agent first adds it to `docs/features/notes.md` on a hub branch (`docs/notes-edit-3`): the product repository's commit hook only accepts `Refs:` IDs the hub defines.

In the worktree the agent works test first (`superpowers:test-driven-development`): a failing test `it('NOTES-EDIT-3: keeps fields the request did not send', …)`, the fix in `update-note.command.ts` and `note.aggregate.ts`, the suite green. The commit body follows the bounded-work format:

```
fix(notes): keep fields a PATCH does not send

Cause: UpdateNoteCommand copied every body field, so omitted fields
became undefined and Prisma wrote them as NULL.
Fix: the command carries only the fields present in the request, and
Note.update() changes only those.
Verification: NOTES-EDIT-3 covers a title-only PATCH; the full suite passes.
Risk: none for clients that send full objects; they behave as before.

Refs: NOTES-EDIT-3
```

### 3. The pull request

> **Agent:** The fix is committed and tested. May I push and open the PR?
> **Lucía:** Go ahead.

```
$ pnpm work:pr api fix/partial-note-update --create
[plan] GitHub: opened https://github.com/acme/notes-api/pull/88
[plan] GitHub: explained the fix on acme/notes-hub#12
```

The PR reads:

```
## Context
Reported in acme/notes-hub#12: **Editing a note's title erases its body**.

## Root cause
UpdateNoteCommand copied every body field, so omitted fields became undefined and Prisma wrote them as NULL.

## What changed
The command carries only the fields present in the request, and Note.update() changes only those.
- fix(notes): keep fields a PATCH does not send
- `apps/api/src/notes/application/commands/update-note/update-note.command.ts` (modified)
- `apps/api/src/notes/domain/note.aggregate.ts` (modified)
- `apps/api/src/notes/application/commands/update-note/update-note.handler.spec.ts` (modified)

## How it was verified
NOTES-EDIT-3 covers a title-only PATCH; the full suite passes.

Tests added or changed:
- `apps/api/src/notes/application/commands/update-note/update-note.handler.spec.ts`

## Risk
None for clients that send full objects; they behave as before.

Fixes acme/notes-hub#12
Refs: NOTES-EDIT-3
```

Irene's issue gets the same explanation as a comment ("Fix ready for review in `api`": root cause, fix, how it was verified, the PR link) and moves to `status:pending-review`.

### 4. The end

Marco reviews and squash merges. GitHub closes #12 through `Fixes`, with the explanation already on it.

The hub PR with `NOTES-EDIT-3` now also moves the `api` submodule pointer to the merged fix, so `pnpm check` sees the test that proves the new criterion:

```bash
git -C repos/api fetch && git -C repos/api checkout --detach origin/main && git add repos/api
pnpm check
git commit -m "docs(features): NOTES-EDIT-3 partial note updates"
```

Lucía merges it, and the agent cleans up:

```
$ pnpm work:cleanup api fix/partial-note-update
[plan] removed .worktrees/api--partial-note-update
```

**What exists afterwards:** one commit on `notes-api` main whose message explains the bug; `NOTES-EDIT-3` in `docs/features/notes.md` with a test titled with it, and the hub pointing at the code that proves it; a closed issue Irene can read without asking anyone. No spec, no plan, no ID: bounded work does not need them.

---

## Example 2: Bulk editing

**Irene opens a feature request** with the feature form:

> **#20 Edit several notes at once**
> Problem: people archive or tag notes one by one; with fifty notes after a project ends, they give up.
> Who: everyone with more than a handful of notes.
> How will we know it worked: people archive or tag 10+ notes in one action; support stops getting "how do I archive many notes" questions.

### 1. Allocating the work

> **Lucía:** Irene's #20 is ready. Can we plan it? It touches the API and the web app.

The agent classifies: *"Two repositories and a new API operation: Architectural."* With Lucía's go-ahead (it writes to GitHub), it adopts the issue:

```
$ pnpm plan:new bulk-edit --repos api,web --issue 20
[plan] GitHub: issue acme/notes-hub#20 tracks this work
[plan] allocated ID 000020 and switched the hub to docs/000020-bulk-edit-spec
  Design spec (brainstorming writes it here):  docs/superpowers/specs/000020-bulk-edit-design.md
  Plan for api (writing-plans writes it here):  docs/superpowers/plans/000020-bulk-edit--api.md
  Plan for web (writing-plans writes it here):  docs/superpowers/plans/000020-bulk-edit--web.md
```

The issue's number is the work ID. #20 keeps Irene's text and gains `tier:architectural`, `type:feat`, `repo:api`, `repo:web`, `status:ongoing` and a comment: "This request is now planned work **000020**…"

### 2. Designing it

The agent runs `graphify-preflight`, then `superpowers:brainstorming`. The preflight's Context block, written into the spec, says what already exists:

```markdown
## Context

Graph refreshed: `graphify update .` → "Rebuilt: 1,904 nodes, 3,871 edges, 32 communities"

**Existing code to reuse or extend**
- `repos/api/src/notes/application/commands/update-note/update-note.handler.ts::UpdateNoteHandler` already validates and applies a partial update to one note (NOTES-EDIT-3).
- `repos/web/app/notes/page.tsx` renders the list; it has no selection state.

**Constraints**
- `docs/contracts/notes-rest.md`: endpoints only add fields; nothing is removed.
```

It asks Lucía its questions one at a time: what can be changed in bulk (archive, unarchive, add or remove a tag; not titles), how many notes at most (Lucía says 200), what happens when some notes fail. It proposes two approaches (one request per note from the web app, or a bulk endpoint applying everything in one transaction) and recommends the bulk endpoint for atomicity. Lucía agrees, the agent presents the design in sections, and then writes the spec. Its key additions:

```markdown
## Acceptance criteria

- **NOTES-BULK-1** When a user submits a bulk change for up to 200 note IDs, the system shall apply it to every note in one transaction and return the updated notes.
- **NOTES-BULK-2** If any listed note does not exist or the change is invalid for it, then the system shall change no note and return the IDs that failed.
- **NOTES-BULK-3** If a bulk change lists more than 200 note IDs, then the system shall reject it with HTTP 400 before reading any note.
- **NOTES-BULK-4** When a user selects notes in the list and chooses an action, the web app shall apply it with one request and show the result in place.
- **NOTES-BULK-5** While a bulk change is in flight, the web app shall disable the selection and the actions.

## Documentation impact

- [ ] `docs/contracts/notes-rest.md`: add `PATCH /notes` (bulk) with its request, response and error shapes
- [ ] `docs/codebases/api/ARCHITECTURE.md`: add BulkUpdateNotesHandler to the notes use cases
- [ ] `docs/codebases/web/ARCHITECTURE.md`: list selection and bulk actions in the notes route group
- [ ] `docs/features/notes.md`: NOTES-BULK-1 to 5 (moved by `pnpm plan:complete`)

## Links

- Feature: [Notes](../../features/notes.md)
```

No ADR: the endpoint is additive and stays inside the notes module. The agent says so in the spec's Decisions section, with the rejected per-note approach and why.

> **Lucía:** Approved.

The agent sets `status: approved` and runs `superpowers:writing-plans`: a three-task plan for `api` (command and handler, validation and the 200 cap, controller and contract types) and a two-task plan for `web` (selection state and toolbar, the API call and in-place refresh). Every commit step carries its footers:

```bash
git commit -m "feat(notes): bulk update handler" --trailer "Task: 1" --trailer "Refs: NOTES-BULK-1, NOTES-BULK-2"
```

### 3. The spec PR

```
$ pnpm plan:pr 000020 --spec --create
[plan] GitHub: opened https://github.com/acme/notes-hub/pull/21
```

The PR body leads with the goal and the five criteria in plain language, so Irene can review it. #20 gets a "Design ready for review" comment and moves to `status:pending-review`. Irene and Marco approve; Lucía merges. `main` now shows the work as approved.

### 4. Building it

Lucía and Marco each start their side; this is the one step the agent cannot do for them, because the new session must start inside the worktree:

```
$ pnpm plan:start 000020 --repo api
[plan] created .worktrees/api--000020-bulk-edit on feat/000020-bulk-edit from fresh origin/main
[plan] installing dependencies (npm ci)
[plan] hook self-test passed (bad commit rejected, valid commit accepted)
[plan] graph refreshed (graphify update .)
  Start the execution session in the worktree:
    cd .worktrees/api--000020-bulk-edit
    claude
  Prompt:
    Execute the plan …/docs/superpowers/plans/000020-bulk-edit--api.md with superpowers:subagent-driven-development
```

#20 moves back to `status:ongoing`. In each worktree, `superpowers:subagent-driven-development` dispatches a fresh implementer per task, reviews each task, and finishes with a whole-branch review. Along the way the API agent finds that the plan's validation step would reject an empty tag list, which the spec allows; it decides and records the decision on the task's commit:

```
Ruling: accept an empty tag list as "no tag change" — the spec allows it and the plan's check did not — one extra validation case if product disagrees
```

The hooks guarantee every commit has `Plan: 000020` (added from the branch name) and a valid `Task:`. When both runs finish, each agent stops and asks before pushing.

### 5. Two code PRs

```
$ pnpm plan:pr 000020 --repo api --scope notes --create
[plan] GitHub: opened https://github.com/acme/notes-api/pull/91
[plan] GitHub: issue stays status:ongoing until web has a PR
$ pnpm plan:pr 000020 --repo web --scope notes --create
[plan] GitHub: opened https://github.com/acme/notes-web/pull/57
```

Each PR has Context, What changed (tasks and files), the criteria it covers, Decisions made during implementation (the ruling above), Review focus (from the plan), How it was verified, and the footers. #20 gets a "Code ready for review" comment per repository, and moves to `status:pending-review` only when both PRs are open. Marco and Lucía review each other's PRs and squash merge.

### 6. Completing it

> **Lucía:** Both PRs are merged; please close out 000020.

```
$ pnpm plan:complete 000020
[plan] docs/superpowers/plans/000020-bulk-edit--api.md: 3/3 tasks done, 1 ruling(s), repos/api -> 4b1e…
[plan] docs/superpowers/plans/000020-bulk-edit--web.md: 2/2 tasks done, 0 ruling(s), repos/web -> 9c07…
[plan] docs/features/notes.md: NOTES-BULK-1, NOTES-BULK-2, NOTES-BULK-3, NOTES-BULK-4, NOTES-BULK-5 now describe main
  Documentation impact still to apply (tick each item in docs/superpowers/specs/000020-bulk-edit-design.md once done):
    - [ ] `docs/contracts/notes-rest.md`: add `PATCH /notes` (bulk) …
    - [ ] `docs/codebases/api/ARCHITECTURE.md`: add BulkUpdateNotesHandler …
    - [ ] `docs/codebases/web/ARCHITECTURE.md`: list selection and bulk actions …
```

On the new branch `docs/000020-bulk-edit-completion` the plans are ticked from the `Task:` footers, the ruling is copied into the api plan's `## Completion`, the submodule pointers point at the merged code, and the criteria are in the feature document. The agent updates the contract and both architecture maps from the merged code, ticks the three items, runs `pnpm check` (green), commits `docs(completion): 000020 bulk-edit`, and opens the completion PR with Lucía's go-ahead. #20 gets a "Shipped" comment: what merged, the behaviour now on `main`, the decision made during implementation, and "Merging it closes this issue." Lucía merges; GitHub closes #20.

```
$ pnpm plan:cleanup 000020
[plan] removed .worktrees/api--000020-bulk-edit
[plan] removed .worktrees/web--000020-bulk-edit
```

**What exists afterwards:** the design and both plans as records in the hub, with what was decided and why; `NOTES-BULK-1` to `5` in the feature document, each tested by a test titled with it; the contract describing `PATCH /notes`; architecture maps that mention the new code; one squash commit per repository whose footers say `Plan: 000020`; a closed issue that tells the whole story to someone who never opened the code.

---

## Example 3: An asynchronous export worker

Users ask to export all their notes. Exports can be large, so Lucía wants them built in the background: a new `exports` module in the API, CQRS like the rest, fitting the hexagonal layout, with an SQS queue feeding a worker process.

### 1. Allocating and designing

> **Lucía:** Let's plan a notes export: the request returns immediately, a worker builds a CSV through SQS and stores it in S3, and the user downloads it when ready. Only the API for now.

There is no issue yet, so `plan:new` creates one in the hub and takes its number:

```
$ pnpm plan:new notes-export --repos api --title "Export notes to CSV"
[plan] GitHub: issue acme/notes-hub#27 tracks this work
[plan] allocated ID 000027 and switched the hub to docs/000027-notes-export-spec
```

The preflight finds what to reuse and what is new: the CQRS `CommandBus` and the repository pattern in `notes/`; no queue, no object storage, no second process anywhere. Brainstorming settles the shape:

- **Domain** (`exports/domain/`): an `Export` aggregate with states `REQUESTED → BUILDING → READY | FAILED`.
- **Application** (`exports/application/`): `RequestExportCommand` (creates the export and enqueues a message), `BuildExportCommand` (run by the worker), `GetExportQuery` (status and download link).
- **Ports and adapters**: an `ExportQueue` port with an `SqsExportQueue` adapter, an `ExportStorage` port with an `S3ExportStorage` adapter, both in `exports/infrastructure/`, so the application layer never imports the AWS SDK.
- **A new process**: `apps/api/src/worker.ts` long-polls SQS and dispatches `BuildExportCommand` through the same `CommandBus`.

This one **needs an ADR**: it adds infrastructure (SQS, S3), a runtime dependency (the AWS SDK) and a second deployable, and the rejected alternatives (an in-process job, a database-backed queue) will come up again. The agent writes `docs/adr/0004-asynchronous-jobs-through-sqs.md` in the spec PR: SQS delivers at least once, so `BuildExportHandler` must be idempotent (it does nothing if the export is already `READY`). The ADR is accepted when the spec PR is approved, so the same PR lists it under "Evolution" in `docs/ARCHITECTURE.md`; `pnpm check` refuses an accepted ADR that is missing there.

The spec's additions include:

```markdown
## Acceptance criteria

- **EXPORT-1** When a user requests an export, the system shall record it as requested and respond with its ID within one second, without building the file.
- **EXPORT-2** When the worker receives an export message, the system shall build a CSV of all the user's notes, store it, and mark the export ready.
- **EXPORT-3** If the same export message is delivered twice, then the system shall build the file only once.
- **EXPORT-4** If building fails three times, then the system shall mark the export failed and keep the message in the dead-letter queue.
- **EXPORT-5** When a user asks for a ready export, the system shall return a download link valid for 15 minutes.

## Documentation impact

- [ ] `docs/codebases/api/architecture/exports.md`: new area document (domain, ports, adapters, worker), `paths: [repos/api/src/exports/**, repos/api/src/worker.ts]`
- [ ] `docs/codebases/api/ARCHITECTURE.md`: the worker as a second deployable; link the exports area
- [ ] `docs/contracts/notes-rest.md`: `POST /exports`, `GET /exports/:id`

## Manual steps

- Create the queue `notes-exports` with a dead-letter queue (3 receives) and the bucket `notes-exports-<stage>` in each stage.
- Give the API role `sqs:SendMessage`, and the worker role `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `s3:PutObject`, `s3:GetObject`.
- Set `EXPORTS_QUEUE_URL` and `EXPORTS_BUCKET` for both processes.
```

The new module is big enough for its own **architecture area document**, so the impact list includes one; its `paths` make `pnpm check` require that the document keeps matching real files. The `cqrs` preset also means every new `*.handler.ts` must appear in an architecture document.

### 2. Building and shipping

From here it runs like example 2, with one repository: spec PR (with the ADR) reviewed and merged, `pnpm plan:start 000027 --repo api`, subagent-driven execution (worker tests use a fake `ExportQueue` and `ExportStorage`; the idempotency test is titled `EXPORT-3: …`), `pnpm plan:pr 000027 --repo api --create`, review, merge.

The difference shows at completion. The spec has a `## Manual steps` section, so when the agent opens the completion PR:

```
$ pnpm plan:pr 000027 --completion --create
[plan] GitHub: opened https://github.com/acme/notes-hub/pull/31
```

the PR has a "Manual steps still needed" section, and #27 gets `status:needs-manual-steps` instead of pending review. Its "Shipped" comment ends: "Merging it closes this issue; the manual steps and deferred items above remain to be done." Whoever runs infrastructure sees exactly what to create, on the issue itself and on the Project board's `status:needs-manual-steps` column.

**What exists afterwards:** `ADR-0004` explaining why jobs go through SQS and must be idempotent, listed under Evolution; an area document for `exports/` that `pnpm check` keeps honest; code in `exports/` whose ports keep AWS out of the application layer, with `// WHY: SQS delivers at least once, so a second delivery must be a no-op (ADR-0004)` where the idempotency check lives, which the graph links to the ADR; the manual steps visible until someone does them.

---

## Example 4: The users and login epic

Irene wants accounts: today every visitor sees every note. She sends a PRD; Lucía has a first technical design.

### 1. Starting the epic

> **Lucía:** Irene's PRD for accounts is in ~/Downloads/accounts-prd.md (her issue is #30), and my design notes are in ~/Downloads/accounts-design.md. Can we turn this into an epic?

The agent loads the `epic-design` skill, and with Lucía's go-ahead:

```
$ pnpm epic:new users-and-login --prd ~/Downloads/accounts-prd.md --issue 30
[plan] GitHub: issue acme/notes-hub#30 tracks epic users-and-login
[plan] stored the PRD as docs/epics/users-and-login/prd.md
[plan] switched the hub to docs/epic-users-and-login
```

#30 gets `tier:epic`, `epic:users-and-login`, `status:ongoing` and "Epic design started". The agent runs the preflight over notes, auth and the web app's routes, then numbers Irene's requirements in `prd.md` without changing her words: **REQ-1** sign up with email and password, **REQ-2** sign in and out, **REQ-3** each user sees only their notes, **REQ-4** existing notes are not lost, **REQ-5** stay signed in for a while, **REQ-6** reset a forgotten password.

### 2. Three rounds of questions

Each round is one message, up to five questions, each with the agent's recommended answer.

**Round 1, the requirements.** Excerpts:

> 1. **REQ-4: who owns the notes that exist today?** There is no user to give them to. *I recommend* a one-off "claim" step: the first account created with the operator's email gets all existing notes; everyone else starts empty. Irene should confirm, because the alternative (deleting them) contradicts "not lost".
> 2. **REQ-5: how long is "a while"?** *I recommend* 30 days of inactivity, renewed on each visit, because that matches the PRD's "don't make me sign in every day".
> 3. **REQ-6 needs email delivery, which we do not have.** *I recommend* moving password reset to a later phase, so the first phases do not wait on an email provider.

> **Lucía:** 1 agree, Irene confirmed. 2 agree. 3 agree, last phase.

**Round 2, edge cases and failure.** The agent asks about brute-force sign-in attempts (it recommends per-account and per-IP rate limits), about what the API does with a note ID that belongs to someone else (it recommends answering 404, not 403, so IDs cannot be probed), and about the bulk edit from example 2 (it recommends that a bulk change listing someone else's note fails as a whole under `NOTES-BULK-2`, which needs no new rule). It also corrects one of Lucía's design notes: her draft had the web app pass a user ID to the API, which anyone could forge; it recommends that the API issue and check session tokens itself.

**Round 3, shape and order.** Phases that each ship alone, smallest first; the contracts that change; the ADRs to write.

The agent summarises everything agreed, Lucía approves, and only then does it write `docs/epics/users-and-login/README.md`:

```markdown
## Requirement map

| Requirement | Phase | Notes |
|---|---|---|
| REQ-1 Sign up | 1 | |
| REQ-2 Sign in and out | 1 | |
| REQ-3 Only your own notes | 2 | Another user's note answers 404 |
| REQ-4 Existing notes are kept | 2 | Claimed by the operator account |
| REQ-5 Stay signed in | 1 | 30 days of inactivity, renewed per visit |
| REQ-6 Reset a forgotten password | 4 | Needs an email provider |

## Phases

| # | Phase | Tier | Work | Status |
|---|---|---|---|---|
| 1 | Accounts, sign-in and sessions | Architectural | not started | planned |
| 2 | Notes belong to users, existing notes claimed | Architectural | not started | planned |
| 3 | Sign-in pages and session handling in the web app | Architectural | not started | planned |
| 4 | Password reset by email | Architectural | not started | planned |
```

`pnpm check` confirms every requirement is mapped and every ID exists. The agent commits and, with Lucía's go-ahead:

```
$ pnpm epic:pr users-and-login --create
[plan] GitHub: opened https://github.com/acme/notes-hub/pull/32
```

The epic PR carries `epic:users-and-login`; #30 gets "Epic design ready for review" with the outcome and phases. Irene reviews the requirement map (she checks that nothing she asked for vanished), Marco reviews the phases, Lucía merges.

### 3. One phase at a time

> **Lucía:** Let's start phase 1.

```
$ pnpm plan:new accounts --repos api,web --epic users-and-login
[plan] GitHub: #33 is a sub-issue of epic #30
[plan] GitHub: issue acme/notes-hub#33 tracks this work
[plan] allocated ID 000033 and switched the hub to docs/000033-accounts-spec
  …
  Link the spec to its epic in "## Links": - Epic: [users-and-login](../../epics/users-and-login/README.md)
```

On GitHub, #33 appears under #30 as a sub-issue; the Project board shows the epic's progress. From here phase 1 runs exactly like example 2: its own brainstorming on the code as it is now, its own spec (whose criteria name their requirements, like `AUTH-1 … (REQ-1)`, and which writes the ADR on the session model), its own plans, a spec PR, execution in both repositories, code PRs, completion. Every PR of the phase, in the hub and in both product repositories, carries the `epic:users-and-login` label. Lucía adds the spec link to the epic's Phases table in the phase's spec PR.

Phase 2 starts only after phase 1's completion PR is merged, with `pnpm plan:new note-ownership --repos api,web --epic users-and-login`. Its design starts from phase 1's merged code, which is why phases are never designed in advance.

If priorities change mid-way (say phase 4 is dropped because the company adopts single sign-on instead), Lucía tells the agent, and it runs `pnpm plan:abandon <id> --reason "…"` for that phase if it was started, and marks REQ-6 out of scope in the requirement map, with the reason, in a hub PR.

### 4. Closing the epic

When every phase links a spec that is done (or abandoned), Lucía sets the epic to `done` on a branch named `docs/epic-users-and-login-complete`. `pnpm check` verifies that no phase was left unstarted, and `pnpm epic:pr users-and-login --create` writes the closing PR with `Closes #30`.

**What exists afterwards:** Irene's PRD next to the design that answered it, with every requirement traceable to a phase, from there to acceptance criteria, tests and code; the questions that were settled before anyone built anything; one sub-issue per phase under the epic; ADRs for the decisions that will matter in two years.

---

## What to take away

| | Bounded fix | Architectural feature | New module | Epic |
|---|---|---|---|---|
| Who starts it | Anyone, from a bug issue or a message | The agent, with `plan:new` | The agent, with `plan:new` | The agent, with `epic:new` and the `epic-design` skill |
| Design artifact | A few lines in chat | Design spec with criteria and documentation impact | Spec, ADR, area document, manual steps | PRD, epic design, then one spec per phase |
| Human gates | Approve the design; approve push; merge | Approve the spec; review the spec PR; approve pushes; review and merge code; merge completion | Same, plus the ADR review and the manual steps | Answer three rounds; approve the summary; review the epic PR; then every phase's gates |
| Trace left behind | Commit message, test titled with a criterion, closed issue | Spec, plans, rulings, criteria, contract, maps, footers, closed issue | All of that, plus the ADR and the area document | All of that per phase, plus the requirement map |

Prefer the left column whenever the change fits it: example 1 cost a fraction of example 2 and left a perfectly good trace. Reach for the right columns when the design deserves to be reviewed and kept.
