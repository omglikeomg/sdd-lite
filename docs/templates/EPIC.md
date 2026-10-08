---
type: epic
status: approved
---
# Faster repeat checkout

<!-- Template: copy to docs/epics/<slug>.md. An epic exists only when the outcome needs more than
     one design spec. Phases are one-line headlines; each becomes a design spec (with its own ID)
     only when the previous phase's completion PR is merged. Status: draft → approved →
     in-progress → done | abandoned. -->

## Outcome

Returning customers complete checkout in under 30 seconds, down from 95 seconds today.

## Why now

Repeat customers produce 60 % of revenue, and 18 % of their checkouts are abandoned on the payment step (analytics, September 2026).

## Success measures

- Median checkout time for returning customers below 30 seconds.
- Payment-step abandonment for returning customers below 8 %.

## Scope

- In: saved cards, address reuse, one-click reorder.
- Out: new payment methods, guest checkout changes.

## Phases

| # | Phase | Design | Status |
|---|---|---|---|
| 1 | Pay with a saved card | [000042](../superpowers/specs/000042-checkout-payments-design.md) | done |
| 2 | Reuse the last shipping address | [000057](../superpowers/specs/000057-address-reuse-design.md) | in-progress |
| 3 | One-click reorder from order history | not started | planned |

## Links

- Feature: [Checkout payments](../features/checkout-payments.md)
