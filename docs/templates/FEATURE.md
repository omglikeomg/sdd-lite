---
type: feature
---
# Checkout payments

<!-- Template: copy to docs/features/<capability>.md and replace the example. One file per user-facing
     capability. This is a living document: it describes what main does today. Criteria arrive here
     in the completion PR of the work that delivered them. -->

As a returning customer, I want to pay with a card I saved before, so that checkout takes one click.

## Acceptance criteria

<!-- One criterion per bullet, ID in bold, EARS wording. IDs are permanent: retire a criterion by
     deleting it, never by reusing its ID. Every ID needs a test whose title starts with "<ID>:". -->

- **CHECKOUT-PAY-1** When a signed-in customer confirms an order with a saved card, the system shall charge that card for the order total and show the confirmation page.
- **CHECKOUT-PAY-2** If the card is declined, then the system shall keep the order unpaid and show the decline reason returned by the payment provider.
- **CHECKOUT-PAY-3** While the payment provider is unavailable, the system shall reject new card payments with HTTP 503 and leave existing orders unchanged.
- **CHECKOUT-PAY-4** The system shall never write a full card number to logs.
- **CHECKOUT-PAY-5** Saved-card checkout in the browser:
  - Given a customer with one saved card on the cart page
  - When they choose "Pay with saved card" and confirm
  - Then they land on the confirmation page within 3 seconds

## Out of scope

- Adding or removing saved cards (see `docs/features/wallet.md`).
- Partial payments and split tenders.

## Where it lives

- API: `repos/api/src/payments/payments.service.ts::PaymentsService`
- Web: `repos/web/app/(shop)/checkout/page.tsx`
- Tests: `repos/api/src/payments/payments.service.spec.ts`, `repos/web/e2e/checkout.spec.ts`

## Links

- [ADR-0012: Payment provider calls are idempotent per order](../adr/0012-idempotent-payment-calls.md)
- [Design 000042: checkout payments](../superpowers/specs/000042-checkout-payments-design.md)
