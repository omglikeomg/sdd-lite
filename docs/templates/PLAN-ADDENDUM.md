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

- Work only inside the worktree created by `pnpm plan:start 000042 --repo api`. Its dependencies are installed; skip the `npm install` of superpowers:using-git-worktrees.
- Commit exactly as each task's commit step says; the hooks reject commits without `Task:`.
- Do not tick checkboxes in this file; `pnpm plan:complete` does it from the commits.
- Where this plan is wrong or silent, rule on it as Superpowers says and keep going. Record every ruling (plan corrections, parked review findings) as a `Ruling:` footer for the task it concerns: `--trailer "Ruling: <decision> — <why> — <cost if wrong>"` on the task's commit, or, when that commit already exists, `git commit --allow-empty -m "chore(plan): record ruling" --trailer "Task: <n>" --trailer "Ruling: …"`. Never amend: the ledger and review packages refer to commits by SHA. Superpowers deletes its ledger when the final review is clean; the footers are what `pnpm plan:complete` copies into the plan.
- Stop-the-line: when a test or check that should pass fails unexpectedly, start no new task until its cause is found and fixed (superpowers:systematic-debugging). This covers unexpected failures only; a plan defect is a ruling, not a stop.
- Stop and ask before a schema change, a new runtime dependency or a CI configuration change that this plan or its spec does not name.
- When the final review is clean, stop and ask your human partner for the go-ahead to push. Do not push before it.
- After the go-ahead, finish with superpowers:finishing-a-development-branch choosing "Push and create a Pull Request", and let the hub do both steps: `pnpm plan:pr 000042 --repo api --scope payments --create` from the hub root in GitHub mode (it pushes, opens the PR and updates the tracking issue); otherwise push and paste the text that command prints. Never merge locally.
- The PR body ends with the `Plan:`, `Task:` and `Ruling:` footers that the squash commit keeps; edit the prose if needed, never the footers.

## Global Constraints

- Node 20, NestJS 11; no new runtime dependencies.

## Review Focus

- An expired saved card is rejected before the provider is called (CHECKOUT-PAY-7).

---

### Task 1: Charge a saved card in PaymentsService

**Blocked by:** None

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
| `## Execution rules` | The executing agent may run in a harness that cannot see the hub's `AGENTS.md`; the executing agent (the controller, under subagent-driven development) reads the plan. Implementer subagents get only their task, so what they must do lives in the task's steps |
| File paths relative to the product repository | The implementer works inside the product repository's worktree |
| Test titles start with the acceptance-criteria ID | `pnpm check` links tests to `docs/features/` |
| Every task has a `**Blocked by:**` line | Your human partner approves the order from the task list; `pnpm check` verifies the line |
| Commit steps carry `--trailer "Task: <n>"` and `Refs:` | Progress and traceability come from git history; the implementer subagent sees only its task |
| Rulings are `Ruling:` footers | Superpowers deletes its ledger when the final review is clean; git history is the record |

## Tasks and their order

Each task is a vertical slice, a tracer bullet: a narrow path through every layer it needs (data, logic, interface, tests) that ends in something testable on its own, never one layer of the whole feature.

`**Blocked by:**` sits under the task heading: `None`, or the earlier tasks of the same plan it needs (`Task 1, Task 3`). A task never waits for a later one; `pnpm check` rejects that, a missing line and any other form.

Order the tasks by these rules, in this order of precedence:

1. **Prefactor first.** Make the change easy, then make the easy change: a refactor that keeps behaviour and makes room for the feature is its own task, before the feature.
2. **Contract first across repositories.** When repositories meet at a contract, the producer's plan opens with the contract (types, schema, endpoint shape) and the consumer's plan builds against the contract the spec fixes. `Blocked by:` never crosses plans.
3. **Riskiest first.** Among tasks the first two rules leave free, the one most likely to prove the design wrong goes first.

A wide refactor (one mechanical change whose call sites span the codebase) cannot land as one green slice. Sequence it as expand–contract: one task adds the new form beside the old, migration tasks move the call sites in batches (each `Blocked by:` the expand task), and a final task removes the old form (`Blocked by:` every batch). Above about 500 mechanical edits (Rule of 500), a batch is a codemod the task writes and runs, not hand edits.

After writing-plans saves the plan, show your human partner its task list, one line per task: the title, `Blocked by:` and the test seam (the task's `Test:` file and the test that proves it). Wait for their approval before the spec PR; the list takes the place of writing-plans' request to review the whole plan.

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
