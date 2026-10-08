---
type: epic
status: approved
issue: 12
---
# Faster repeat checkout

<!-- Template: the epic-design skill writes this file at docs/epics/<slug>/README.md, next to the
     PM's requirements in docs/epics/<slug>/prd.md. It is the technical design that pairs with the
     PRD: what we will build, in which order, and why. `issue` is the GitHub tracking issue that
     `pnpm epic:new` created or adopted (leave it out without GitHub mode).
     Status: draft → approved (epic PR merged) → in-progress → done | abandoned. -->

## Outcome

Returning customers complete checkout in under 30 seconds (95 seconds today), because 18 % of their checkouts are abandoned at the payment step.

## Requirement map

<!-- Every REQ-n from prd.md appears here exactly once: mapped to a phase, or out of scope with the
     reason. `pnpm check` fails if one is missing or unknown. -->

| Requirement | Phase | Notes |
|---|---|---|
| REQ-1 Pay with a saved card | 1 | |
| REQ-2 Reuse the last shipping address | 2 | |
| REQ-3 Reorder from order history | 3 | |
| REQ-4 Saved cards for guests | Out of scope | The provider deletes guest customers after 90 days (spike 2026-10-02) |

## Architecture direction

- Saved cards stay in the payment provider's vault; we store only its customer ID (no card data).
- Address reuse reads the last order's address; no new address book.
- Reorder builds a new cart from an order and sends it through the normal checkout.

## Contracts

- `docs/contracts/catalog-graphql.md` gains `customer.paymentMethods` in phase 1.

## Decisions

- [ADR-0012: Payment provider calls are idempotent per order](../../adr/0012-idempotent-payment-calls.md)

## Edge cases and questions settled while designing

<!-- What the epic-design conversation challenged, and what was agreed. -->

- **A saved card expires between checkout start and confirmation:** the payment fails with the provider's reason and the customer can pick another card (phase 1).
- **The last order shipped to a country we no longer serve:** the address is not offered (phase 2).
- **Reordering an item that is out of stock:** the new cart keeps the item, marked unavailable, and checkout blocks until it is removed (phase 3).

## Phases

<!-- One row per phase, in order. A phase ships on its own and becomes one piece of planned work
     (`pnpm plan:new <slug> --repos … --epic <epic>`) or bounded work when it starts; put its design
     spec link in the Work column then. The epic can be done only when every phase links a spec
     that is done or abandoned. -->

| # | Phase | Tier | Work | Status |
|---|---|---|---|---|
| 1 | Pay with a saved card | Architectural | [000042](../../superpowers/specs/000042-checkout-payments-design.md) | done |
| 2 | Reuse the last shipping address | Architectural | [000057](../../superpowers/specs/000057-address-reuse-design.md) | in progress |
| 3 | One-click reorder from order history | Architectural | not started | planned |

## Links

- Product requirements: [prd.md](prd.md)
