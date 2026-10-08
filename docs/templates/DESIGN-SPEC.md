---
type: design
status: draft
---
# Checkout with saved cards: design

<!-- Template: superpowers:brainstorming writes the design document at the path printed by
     `pnpm plan:new` (docs/superpowers/specs/<id>-<slug>-design.md). Keep the frontmatter and the
     four sections marked "hub" below; the other sections are Superpowers' own and follow its skill.
     Set status: approved when your human partner approves the written spec. -->

**ID:** 000042 · **Repositories:** api, web

## Goal

Returning customers pay with a saved card in one step, cutting checkout abandonment for repeat orders.

## Context

<!-- hub: paste the graphify-preflight Context block. Every path in it was opened while writing it. -->

Graph refreshed: `graphify update .` → "Rebuilt: 4,812 nodes, 9,733 edges, 61 communities" (2026-10-08)
Document layer: up to date

**Existing code to reuse or extend**
- `repos/api/src/payments/payments.service.ts::PaymentsService` already charges one-off cards through the provider SDK; saved-card charges extend it.
- `repos/web/app/(shop)/checkout/page.tsx` renders the card form; the saved-card option is added there.

**Constraints**
- ADR-0012: provider calls carry an idempotency key per order.
- CHECKOUT-PAY-1 to CHECKOUT-PAY-3 in `docs/features/checkout-payments.md` describe the one-off card flow and must keep passing.

**High-traffic modules touched**
- `repos/api/src/payments/payments.module.ts` (degree 47).

## Approach

<!-- Superpowers sections: architecture, components, data flow, error handling, testing. -->

The API gains `POST /orders/:id/payments/saved-card`, which loads the customer's saved payment method from the provider and charges it through the existing `PaymentsService.charge` path, reusing its idempotency handling. The web checkout page lists saved cards from `GET /me/payment-methods` and posts the chosen one. No new tables: saved cards stay in the provider's vault.

Errors: provider declines map to HTTP 402 with the provider's reason; provider outages map to HTTP 503 (unchanged behaviour). Testing: Jest unit tests around `PaymentsService` with the provider client faked; one Playwright test for the browser flow against the API's test mode.

## Acceptance criteria

<!-- hub: new or changed behaviour only, EARS, bold IDs. pnpm plan:complete moves them into the
     feature document named under "Links" (an existing ID is replaced, a new one appended). For
     several capabilities, group criteria under "### [Feature](link)" headings. Reuse the
     capability's prefix; never reuse a retired ID. -->

- **CHECKOUT-PAY-6** When a signed-in customer pays an order with a saved card, the system shall charge that saved card through the payment provider using the order's idempotency key.
- **CHECKOUT-PAY-7** If the saved card has expired, then the system shall reject the payment with HTTP 422 before calling the payment provider.
- **CHECKOUT-PAY-8** Where a customer has no saved cards, the checkout page shall show only the new-card form.

## Decisions

<!-- hub: link ADRs this design creates or depends on. Most designs create none; see the ADR
     triggers in docs/WORKFLOW.md. -->

- Depends on [ADR-0012](../../adr/0012-idempotent-payment-calls.md).
- Creates none: saved cards stay in the provider's vault, which is reversible and inside one module.

## Manual steps

<!-- hub, optional: things people must do that code and deploys cannot (secrets, data backfills, a
     deploy order, telling partners). If present, the completion marks the tracking issue
     status:needs-manual-steps and repeats these steps in its closing comment. Delete the section
     when there are none. -->

- Create the secret `PAYMENT_VAULT_KEY` in the production SST stage before the first deploy.
- Tell the support team that saved cards appear under "Wallet" in the admin panel.

## Links

<!-- hub -->

- Feature: [Checkout payments](../../features/checkout-payments.md)
  <!-- For a capability with no feature document yet, write the path in backticks instead,
       `docs/features/<name>.md`; pnpm plan:complete creates it and moves the criteria there. -->
- Epic: [Faster repeat checkout](../../epics/faster-repeat-checkout.md)
- Plans: `docs/superpowers/plans/000042-checkout-payments--api.md`, `docs/superpowers/plans/000042-checkout-payments--web.md`
  <!-- Backticked paths, not links: the spec is written before its plans exist. Each plan links back
       to this spec, which gives Graphify the edge. -->
