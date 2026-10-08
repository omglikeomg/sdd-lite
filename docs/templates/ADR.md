---
type: adr
status: proposed
---
# ADR-0012: Payment provider calls are idempotent per order

<!-- Template: copy to docs/adr/NNNN-<slug>.md with the next free four-digit number. Write one only
     when a trigger in docs/WORKFLOW.md ("ADRs") applies. Status: proposed → accepted (add it to
     "Evolution" in docs/ARCHITECTURE.md) → superseded (keep the file, link the successor). -->

## Context

A network timeout between the API and the payment provider leaves us unsure whether a charge went through. Retrying blindly has already charged two customers twice (incident of 2026-09-14). The provider accepts an idempotency key per request and returns the original result for a repeated key within 24 hours.

## Decision

Every call that moves money passes the order ID as the idempotency key. Retries reuse the key; a new key is only ever minted for a new order.

## Consequences

- Retrying after a timeout is safe and the duplicate-charge incident class disappears.
- An order can be charged once; charging an order again requires a new order. Partial payments would need a new decision.
- Code implementing this cites the decision: `// WHY: retries reuse the order's key so a timeout never double-charges (ADR-0012)`.

## Alternatives considered

- **Look up the charge before retrying:** two calls per retry, and the lookup itself can time out.
- **Never retry, ask the customer:** shifts our failure to the customer and loses sales.

## Links

- Code: `repos/api/src/payments/payments.service.ts::PaymentsService`
- Feature: [Checkout payments](../features/checkout-payments.md)
- Supersedes: none
