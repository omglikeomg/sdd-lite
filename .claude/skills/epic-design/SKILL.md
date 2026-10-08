---
name: epic-design
description: Use when someone brings a PRD, product brief or large outcome that needs several pieces of work, or asks to create or refine an epic - challenges the requirements and the technical design in a short conversation before writing the epic's design and phases
---

# Epic design

## Overview

An epic pairs the product requirements (the PM's PRD) with a technical design and splits the outcome into phases that each ship on their own. Your job is to find what the documents do not say before anyone builds on them: gaps, contradictions, edge cases, risky assumptions. Then write the agreed design.

**Announce at start:** "Using epic-design to review the PRD and design with you before writing the epic."

This skill replaces brainstorming's "decompose into sub-projects" step for work of this size. Each phase later gets its own `superpowers:brainstorming` and design spec when it starts.

<HARD-GATE>
Do not write `docs/epics/<slug>/README.md` until the question rounds are finished and your human partner has approved the summary of agreed answers. Do not start any phase.
</HARD-GATE>

## Checklist

Create a todo for each item and complete them in order.

1. **Collect the inputs.** The PRD (a file, an issue, pasted text) and the engineer's technical design if there is one. If GitHub mode is on and the request is an issue, use its number.
2. **Start the epic:** `pnpm epic:new <slug> [--prd <file>] [--issue <n>]` (ask before running it in GitHub mode: it creates or labels an issue). It creates the branch and stores the PRD at `docs/epics/<slug>/prd.md`.
3. **Ground it:** run the `graphify-preflight` skill for the areas the PRD touches. Note existing code to reuse, contracts in `docs/contracts/`, ADRs and feature criteria that constrain the design.
4. **Number the requirements.** Mark each requirement in `prd.md` with a bold ID (`**REQ-1**`, `**REQ-2**`, …) without changing the PM's words. Where one sentence holds two requirements, split it and say so.
5. **Question rounds, at most three.** Each round is one message with up to five numbered questions, most important first. For each question give your recommended answer and why, so your human partner can reply "agree" or correct you. Stop early when nothing important is left.
   - **Round 1, the requirements:** ambiguous or untestable requirements, contradictions between the PRD and the design, missing actors or states, success measures you cannot observe.
   - **Round 2, edge cases and failure:** empty and maximum inputs, concurrency, partial failure, permissions, existing data and migrations, rollback, privacy and security, performance limits.
   - **Round 3, shape and order:** phase boundaries (each phase shippable alone, smallest first), contracts that change, decisions that need ADRs, what moves out of scope, risks worth a spike.
6. **Summarise the agreed answers** in a short list and ask for approval.
7. **Write `docs/epics/<slug>/README.md`** from `docs/templates/EPIC.md`: Outcome, Requirement map (every REQ-n to a phase or out of scope, with the reason), Architecture direction, Contracts, Decisions, Edge cases and questions settled while designing, Phases (tier per phase; bounded where a phase fits one repository and an existing flow). Write it with `status: approved`, since your human partner approved the summary in step 6, and set `issue:` in the frontmatter if `epic:new` printed one.
8. **`pnpm check`** until it passes, commit `docs(epic): <slug>`, and after your human partner's go-ahead `pnpm epic:pr <slug> --create` (GitHub mode) or paste its printed text into the PR.
9. **Hand over:** phases start one at a time after the epic PR merges: `pnpm plan:new <phase-slug> --repos <…> --epic <slug>` for architectural phases, `pnpm work:start` for bounded ones. Each phase's acceptance criteria name the requirements they fulfil, like `(REQ-2)`.

## Red flags

| Thought | Reality |
|---|---|
| "The PRD is clear, no questions needed" | Every PRD omits failure modes. Ask round 2 at least. |
| "I'll ask everything at once" | Five questions per round, most important first. A wall of questions gets skimmed. |
| "I'll leave a requirement unmapped until we know more" | Map it to a phase, a spike, or out of scope with the reason. The check enforces it. |
| "One big phase is simpler" | Phases ship alone. If a phase cannot be released by itself, split it. |
| "I'll write phase specs now while I have context" | Each phase is designed when it starts, on the code as it is then. |
