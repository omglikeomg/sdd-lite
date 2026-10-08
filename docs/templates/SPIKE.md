---
type: spike
status: done
---
# Can the payment provider vault cards for guests?

<!-- Template: copy to docs/spikes/YYYY-MM-DD-<slug>.md. Most spikes need no file: Superpowers
     reports the answer in chat. Write one only when the findings matter later and no ADR records
     them. Code written during a spike is throwaway. -->

## Question

Can we save a card for a guest (no account) and charge it on their next visit, without storing card data ourselves?

## Method

Two hours against the provider's sandbox: created guest customers through the SDK, vaulted a test card, charged it from a second session. Read the provider's data-retention terms.

## Findings

- Vaulting works for any customer object, including guests.
- The provider deletes guest customers with no activity after 90 days, silently.
- Charging a vaulted card from a new session needs the customer ID, so we would have to persist it against an email address.

## Recommendation

Do not offer saved cards to guests. The 90-day deletion makes the feature unreliable, and persisting provider IDs against emails creates a personal-data store we do not have today. Revisit only with an account-light sign-in.

## Links

- Epic: [Faster repeat checkout](../epics/faster-repeat-checkout.md)
