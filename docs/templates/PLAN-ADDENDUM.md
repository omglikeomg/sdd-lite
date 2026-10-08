# Plan addendum

`superpowers:writing-plans` writes the plan in its own format. These are the additions the hub needs, shown in place in an abbreviated example plan. Plans have no frontmatter.

````markdown
# Checkout with saved cards (api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge a customer's saved card for an order through the existing payments service.

**Architecture:** A new endpoint on the payments controller delegates to `PaymentsService.chargeSavedCard`, which reuses the idempotent charge path.

**Tech Stack:** NestJS 11, Jest, payment provider SDK

**Spec:** [000042 design](../specs/000042-checkout-payments-design.md)

**Repo:** `repos/api`

**Branch:** `feat/000042-checkout-payments`

## Execution rules

- Work only inside the worktree created by `pnpm plan:start 000042 --repo api`.
- Commit exactly as each task's commit step says; the hooks reject commits without `Task:`.
- Do not tick checkboxes in this file; `pnpm plan:complete` does it from the commits.
- Record every deviation from this plan as a `Ruling:` footer on the commit of the task it concerns: `--trailer "Ruling: <decision> — <why> — <cost if wrong>"`. A ruling made after the last task commit goes on that commit with `git commit --amend --no-edit --trailer "Ruling: …"` before pushing. Superpowers deletes its ledger when the final review is clean; the footers are what `pnpm plan:complete` copies into the plan.
- When the final review is clean, stop and ask your human partner for the go-ahead to push. Do not push before it.
- After the go-ahead, finish with superpowers:finishing-a-development-branch choosing "Push and create a Pull Request", and let the hub do both steps: `pnpm plan:pr 000042 --repo api --scope payments --create` from the hub root in GitHub mode (it pushes, opens the PR and updates the tracking issue); otherwise push and paste the text that command prints. Never merge locally.
- The PR body ends with the `Plan:`, `Task:` and `Ruling:` footers that the squash commit keeps; edit the prose if needed, never the footers.

## Global Constraints

- Node 20, NestJS 11; no new runtime dependencies.

## Review Focus

- An expired saved card is rejected before the provider is called (CHECKOUT-PAY-7).

---

### Task 1: Charge a saved card in PaymentsService

**Files:**
- Modify: `src/payments/payments.service.ts`
- Test: `src/payments/payments.service.spec.ts`

**Interfaces:**
- Produces: `chargeSavedCard(orderId: string, paymentMethodId: string): Promise<Charge>`

- [ ] **Step 1: Write the failing test**

```ts
it('CHECKOUT-PAY-6: charges the saved card with the order idempotency key', async () => {
  await service.chargeSavedCard('order-1', 'pm_123');
  expect(provider.charge).toHaveBeenCalledWith(
    expect.objectContaining({ paymentMethod: 'pm_123', idempotencyKey: 'order-1' }),
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm jest src/payments/payments.service.spec.ts -t CHECKOUT-PAY-6`
Expected: FAIL with "service.chargeSavedCard is not a function"

- [ ] **Step 3: Implement `chargeSavedCard` in `src/payments/payments.service.ts`**

Reuse the private `charge` helper so the idempotency key handling stays in one place.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm jest src/payments/payments.service.spec.ts -t CHECKOUT-PAY-6`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/payments/payments.service.ts src/payments/payments.service.spec.ts
git commit -m "feat(payments): charge saved cards" --trailer "Task: 1" --trailer "Refs: CHECKOUT-PAY-6, ADR-0012"
```
````

What changed from the plain Superpowers format:

| Addition | Why |
|---|---|
| `**Repo:**` and `**Branch:**` header lines | `pnpm plan:start` creates the branch named here; `pnpm check` verifies both |
| `**Spec:**` is a relative Markdown link | `pnpm check` resolves it, and Graphify links plan to spec |
| `## Execution rules` | The executing agent may run in a harness that cannot see the hub's `AGENTS.md`; every executor reads the plan |
| File paths relative to the product repository | The implementer works inside the product repository's worktree |
| Test titles start with the acceptance-criteria ID | `pnpm check` links tests to `docs/features/` |
| Commit steps carry `--trailer "Task: <n>"` and `Refs:` | Progress and traceability come from git history; the implementer subagent sees only its task |
| Rulings are `Ruling:` footers | Superpowers deletes its ledger at the end of a run; git history is the record |

`pnpm plan:complete` later appends a `## Completion` section like this one:

```markdown
## Completion

**Completed:** 2026-10-21

**Merged:** `repos/api@3f9c2a71b0de` feat(payments): checkout with saved cards (#318)

### Rulings

- Ruling: kept provider SDK v14 — v15 changes webhook signatures — one extra upgrade task later

### Deferred

- Task 4: Retry declined saved cards once
```
