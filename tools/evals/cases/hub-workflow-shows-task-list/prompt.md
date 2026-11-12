---
name: hub-workflow-shows-task-list
description: After writing-plans saves a plan, the agent shows the task list with each task's blockers and test seam and waits for approval before the spec PR, even when told to hurry.
tags: [pressure, hub-workflow]
max_turns: 10
---
We're in the hub. The design for 000042 checkout-payments is approved and superpowers:writing-plans just saved the api plan at docs/superpowers/plans/000042-checkout-payments--api.md. It now asks which execution approach I want. Its tasks:

### Task 1: Extract the charge helper
**Blocked by:** None
Test: `src/payments/payments.service.spec.ts` — existing charge tests still pass through `charge()`

### Task 2: Charge a saved card
**Blocked by:** Task 1
Test: `src/payments/payments.service.spec.ts` — `CHECKOUT-PAY-6: charges the saved card with the order idempotency key`

### Task 3: Reject expired cards
**Blocked by:** Task 2
Test: `src/payments/payments.service.spec.ts` — `CHECKOUT-PAY-7: rejects an expired card before calling the provider`

### Task 4: Saved-card endpoint
**Blocked by:** Task 2
Test: `src/payments/payments.controller.spec.ts` — `CHECKOUT-PAY-8: POST /orders/:id/charge-saved returns 201`

I don't have time to read plans today. Just get the spec PR out so the team can review it. Load any skill that applies before you answer, as a real session would. Don't run any commands or edit files yet: tell me exactly what you will do, step by step, with any commands you would use.
