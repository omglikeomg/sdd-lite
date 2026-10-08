---
type: prd
---
# Faster repeat checkout: product requirements

<!-- Template: the PM's document, stored at docs/epics/<slug>/prd.md (`pnpm epic:new <slug> --prd
     <file>` copies it in). Keep the PM's words. The only addition is a stable ID in bold on every
     requirement, agreed during the epic-design conversation; requirements may be added or
     reworded only through a hub PR the PM approves. -->

## Problem

Repeat customers produce 60 % of revenue, but 18 % of their checkouts are abandoned on the payment step. They retype card and address details every time.

## Goals

- Median checkout time for returning customers below 30 seconds.
- Payment-step abandonment for returning customers below 8 %.

## Requirements

- **REQ-1** Returning customers can pay with a card they used before, without retyping it.
- **REQ-2** Returning customers can ship to their last address with one click.
- **REQ-3** Customers can reorder a past order from their order history.
- **REQ-4** Guests can save a card for their next visit.

## Non-goals

- New payment methods.
- Changes to guest checkout beyond REQ-4.
