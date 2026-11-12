---
name: hub-retro
description: Use when your human partner asks for a retro or retrospective of recent hub work, or asks what the hub's rules, checks, templates or skills should change because rulings, review findings, check failures or abandoned plans keep repeating, not to explain a single session (diagnosing-superpowers does that) - proposes hub changes, each with its evidence and tier
---

# Hub retro

## Overview

Look back over recent hub work and propose what the hub itself should change so the same trouble does not come back: a check, a template slot, a skill, or, last, a written rule. The output is a list of proposals with evidence. Nothing is edited.

**Announce at start:** "Using hub-retro to propose hub changes from recent work."

**Core principle:** a check that fails beats a sentence that asks. A written rule loads into every session and can be argued with; a deterministic check cannot. `tools/lib/floor.mjs::weakenedChecks` is the model: a recurring reviewer worry ("did this PR lower the bar?") became code that reads the diff.

## When NOT to use

- Why one Superpowers session looped, stalled, cost too much or skipped a skill: `superpowers:diagnosing-superpowers`. It explains a session from its transcript; `hub-retro` decides what the hub should change across many pieces of work. When a diagnosis shows a hub gap, a retro can take its report as evidence.
- Implementing a proposal your partner picked: that is new work. Classify it and start it through `hub-workflow` (a hub change goes on its own `<type>/<slug>` branch from fresh `main`).
- Reviewing someone else's pull request: `review-pull-request`.

## Window

The range your partner names. Otherwise the last 30 days; say which you used.

## Evidence

Read only. Run the hub commands from the hub root, and the `git -C` ones for each repository in `hub.config.json`.

| Evidence | Where it lives | How to read it |
|---|---|---|
| Rulings | `## Completion` → `### Rulings` in `docs/superpowers/plans/`; `Ruling:` footers on hub and product commits | `grep -n -A30 '^### Rulings' docs/superpowers/plans/*.md`; `git log --since=<date> --grep='^Ruling:' --format='%h %s%n%(trailers:key=Ruling,valueonly)'` (also with `git -C repos/<name>`) |
| Review findings | Parked findings (rulings of the form `Task <N>: parked — <finding> — Ruling: …`); `.reviews/*/review.md` (local, not in git); review comments on GitHub in GitHub mode | the rulings above; `grep -n '^###' .reviews/*/review.md`; `gh pr view <n> --comments` (read only) |
| Check failures | Not stored anywhere. Their traces: `Cause:` paragraphs of `fix` commits, eval pass rates written in commit bodies, `.skill-evals/*/result.json` | `git log --since=<date> --format='%h %s%n%b' --grep='^fix' --grep='Cause:' --grep='of 3'`; read the `result.json` files |
| Abandoned work | `status: abandoned` specs; the body of each `docs(spec): abandon <id>` commit holds the reason | `grep -l 'status: abandoned' docs/superpowers/specs/*.md`; `git log --grep='^docs(spec): abandon' --format='%h %s%n%b'` |

A source that is empty in the window is a finding of its own: say so in Notes. Missing evidence is never filled in from memory or from general best practice.

## Pick the change

Group the evidence by what went wrong. A group becomes a proposal only when it **recurs**: two or more occurrences, in different commits, plans or reviews. A single occurrence goes under Notes, however serious it looks.

For each group, take the first kind on this list that would have stopped it:

1. **Check**: a `pnpm check` rule (`tools/docs-check.mjs`), a test in `tools/test/`, a git hook in `tools/git-hooks/`, or a harness permission rule (`.claude/settings.json`, e.g. `ask` on `Bash(git push:*)`).
2. **Template slot**: a required field in `docs/templates/` that `pnpm check` can see is filled.
3. **Skill change**: wording in `.claude/skills/`, shipped with a trigger prompt or eval case that fails before the change.
4. **Written rule**: `AGENTS.md` or `docs/WORKFLOW.md`. Only for a judgement no check can make, and the proposal says why.

Also propose **removals**: a written rule that a check now enforces, or that the evidence shows never changes behaviour.

## The report

One message, these parts in this order:

1. **Window and sources**: the range, and for each of the four sources how many items it held.
2. **Proposals**, most costly trouble first, each exactly:

   ```markdown
   ### P1. <what changes, in a few words>
   - **Evidence:** <hash, path or path::Symbol> — <what it shows>; one line per occurrence, two or more
   - **Change:** <check | template slot | skill change | written rule | removal>: <the file or path::Symbol it touches and what it does>
   - **Why not a check:** <only for a skill change or written rule>
   - **Tier:** <Trivial | Bounded | Architectural | Epic>, <one line why>
   ```

3. **Notes**: single occurrences, empty sources, evidence the hub does not record.
4. **The question**: "Which of these, if any, should start?" Nothing else follows it.

## Red flags

| Thought | Reality |
|---|---|
| "They said fix it, I'll draft the edits" | The retro proposes. A picked proposal starts as its own work, classified, on its own branch. |
| "A stronger line in AGENTS.md will stop it" | Walk the list from Check down. A rule is the last resort and says why no check fits. |
| "One bad occurrence is enough" | One is a Note. Two or more make a proposal. |
| "Nothing much in the history, I'll add general advice" | Every proposal cites the window's evidence. A thin window gives a short report. |
| "I can tell from the commit message, no need to open it" | Read the commit body or file you cite. |
| "The session went wrong, so this is a retro" | Explaining one session is `superpowers:diagnosing-superpowers`. |

## Verification

Before you send the report:

- [ ] Every proposal has two or more evidence lines from the window — **Evidence:** the hashes and paths under each `**Evidence:**`.
- [ ] Every skill change or written rule says why no check fits — **Evidence:** its `**Why not a check:**` line.
- [ ] Every proposal names its tier — **Evidence:** its `**Tier:**` line.
- [ ] Nothing was edited, committed or pushed — **Evidence:** `git status` unchanged since the retro started; the report ends with the question.
