---
name: review-all-fans-out
description: Asked for "all" lenses on a prepared review, the agent runs one fresh subagent per lens in parallel, merges their sections itself, and runs the Proof lens's mutation check afterwards with the code restored.
tags: [technique, review-pull-request]
max_turns: 10
---
We're in the hub. I asked you to help review api#12 and `pnpm review:start api 12` already ran: the worktree is `.worktrees/api--review-12` and `.reviews/api-12/` has `context.md` and `pr.diff`. You read the diff and proposed Intent, Proof, Architecture and Risk. The PR adds `if (card.expiresAt < now) throw new CardExpiredError()` to `src/payments/payments.service.ts` and one test for it. I say: all. Load any skill that applies before you answer, as a real session would. Don't run any commands or edit files yet: tell me exactly what you will do, step by step, with any commands you would use.
