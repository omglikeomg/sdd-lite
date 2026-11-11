---
name: epic-design
description: Use when someone brings a PRD, product brief or large outcome that needs several pieces of work, or asks to create or refine an epic - produces the epic's agreed design and its phases, each shippable alone
---

# Epic design

## Overview

An epic pairs the product requirements (the PM's PRD) with a technical design and splits the outcome into phases that each ship on their own. Your job is to find what the documents do not say before anyone builds on them: gaps, contradictions, edge cases, risky assumptions. Then write the agreed design.

**Announce at start:** "Using epic-design to review the PRD and design with you before writing the epic."

This skill replaces brainstorming's "decompose into sub-projects" step for work of this size. Each phase later gets its own `superpowers:brainstorming` and design spec when it starts.

<HARD-GATE>
Do not write `docs/epics/<slug>/README.md` until the frontier of questions is empty (or your human partner said to wrap up) and your human partner has approved the summary of agreed answers. Do not start any phase.
</HARD-GATE>

## When NOT to use

- One change in one repository with a clear outcome: classify it Trivial, Bounded or Architectural and follow `hub-workflow`.
- A phase of an approved epic is starting: `pnpm plan:new <phase-slug> --repos <…> --epic <slug>` and `superpowers:brainstorming` design it.
- An idea with no PRD, brief or outcome yet: `superpowers:brainstorming` first.

## Checklist

Create a todo for each item and complete them in order.

1. **Collect the inputs.** The PRD (a file, an issue, pasted text) and the engineer's technical design if there is one. If GitHub mode is on and the request is an issue, use its number.
2. **Start the epic:** `pnpm epic:new <slug> [--prd <file>] [--issue <n>]` (ask before running it in GitHub mode: it creates or labels an issue). It creates the branch and stores the PRD at `docs/epics/<slug>/prd.md`.
3. **Ground it:** run the `graphify-preflight` skill for the areas the PRD touches. Note existing code to reuse, contracts in `docs/contracts/`, ADRs and feature criteria that constrain the design, and the glossary terms the PRD's words map to.
4. **Number the requirements.** Mark each requirement in `prd.md` with a bold ID (`**REQ-1**`, `**REQ-2**`, …) without changing the PM's words. Where one sentence holds two requirements, split it and say so.
5. **Question rounds until the frontier is empty.** The frontier is every open question your human partner can answer now: none of its prerequisites is still waiting for an answer. Each round is one message holding the frontier's five most important questions, numbered, most important first; the rest of the frontier waits for the next round. A question that depends on an answer you have not heard yet is not on the frontier, whatever its theme. For each question give your recommended answer and why, so your human partner can reply "agree" or correct you. Facts the graph or the code can answer are yours to look up, never questions. After each round's answers, recompute the frontier: settled answers unblock the questions that waited on them, and may make others moot. There is no round limit. Stop when the frontier is empty and every theme below has been covered, or when your human partner says to wrap up; then every question still open goes into step 6's summary with your recommended answer, marked as an assumption.

   The themes are a coverage checklist, not an order: any of them can be on the first frontier.
   - **The requirements:** ambiguous or untestable requirements, contradictions between the PRD and the design, missing actors or states, success measures you cannot observe, and words the glossary lacks, defines differently or lists under another term's `_Avoid_:` line ("The PRD says 'member'; the glossary avoids it for **Customer**. A Customer who joined, or something new?").
   - **Edge cases and failure:** empty and maximum inputs, concurrency, partial failure, permissions, existing data and migrations, rollback, privacy and security, performance limits.
   - **Shape and order:** phase boundaries (each phase shippable alone, smallest first), contracts that change, decisions that need ADRs, what moves out of scope, risks worth a spike.

   These rounds are the epic's only. When a phase starts, `superpowers:brainstorming` designs it one question per message and does not reopen what the epic's README settled.
6. **Summarise the agreed answers** in a short list and ask for approval.
7. **Write `docs/epics/<slug>/README.md`** from `docs/templates/EPIC.md`: Outcome, Requirement map (every REQ-n to a phase or out of scope, with the reason), Architecture direction, Contracts, Decisions, Edge cases and questions settled while designing (including each agreed term with its definition), Phases (tier per phase; bounded where a phase fits one repository and an existing flow). Write it with `status: approved`, since your human partner approved the summary in step 6, and set `issue:` in the frontmatter if `epic:new` printed one.
8. **`pnpm check`** until it passes, commit `docs(epic): <slug>`, and after your human partner's go-ahead `pnpm epic:pr <slug> --create` (GitHub mode) or paste its printed text into the PR.
9. **Hand over:** phases start one at a time after the epic PR merges: `pnpm plan:new <phase-slug> --repos <…> --epic <slug>` for architectural phases, `pnpm work:start` for bounded ones. Each phase's acceptance criteria name the requirements they fulfil, like `(REQ-2)`.

## Red flags

| Thought | Reality |
|---|---|
| "The PRD is clear, no questions needed" | Every PRD omits failure modes. Cover edge cases and failure at least. |
| "I'll ask everything at once" | Five questions per round, most important first. A wall of questions gets skimmed. |
| "That's a failure (or limit, or risk) question, it belongs in a later round" | Themes are not an order. If nothing it depends on is still open, it is on the frontier now. |
| "I'll ask the phase split now, alongside the requirements it depends on" | Its answer would rest on guesses. It joins the frontier once those requirements are settled. |
| "Three rounds is enough" | There is no round limit. Stop when the frontier is empty or your partner says to wrap up. |
| "I'll leave a requirement unmapped until we know more" | Map it to a phase, a spike, or out of scope with the reason. The check enforces it. |
| "I'll add the agreed terms to the glossary now" | The glossary describes `main`. The README records the definition; the phase that ships the term lists `docs/GLOSSARY.md` in its Documentation impact. |
| "One big phase is simpler" | Phases ship alone. If a phase cannot be released by itself, split it. |
| "I'll write phase specs now while I have context" | Each phase is designed when it starts, on the code as it is then. |

## Verification

Before you say this skill's work is done:

- [ ] Every requirement in `prd.md` has a bold `REQ-n` ID — **Evidence:** the IDs in `docs/epics/<slug>/prd.md`.
- [ ] Your human partner approved the summary of agreed answers before the README existed — **Evidence:** their approval message in the conversation, before the `docs(epic): <slug>` commit.
- [ ] Every `REQ-n` maps to a phase, a spike or out of scope with its reason — **Evidence:** the Requirement map in `docs/epics/<slug>/README.md` and a passing `pnpm check`.
- [ ] No phase was started — **Evidence:** no `plan:new` or `work:start` ran in this session.
- [ ] Nothing left the machine without a go-ahead — **Evidence:** your partner's message right before `pnpm epic:pr <slug> --create`.
