---
type: pattern
---
# Idempotent message handlers

<!-- Template: copy to docs/patterns/<slug>.md. A pattern is how this team builds one kind of
     thing, written as rules an agent can follow and a reviewer can check: aim for 50 to 100
     lines. Keep only real opinions; leave out what any competent engineer already does. Give
     every rule its reason, because a rule without one gets dropped the first time it is
     inconvenient. When a tool can enforce a rule, end it with `[check: <tool>: <what>]`
     (Biome, dependency-cruiser, tsc, a test…) and set the tool up: a check beats prose. Architecture maps say which patterns new code follows and
     where existing code deviates; the preflight, onboarding and review skills read them from
     there. -->

Every consumer of a queue, topic or webhook, whatever the broker.

## When it applies

- Applies: any handler of messages delivered at least once (SQS, SNS, EventBridge, Kafka, RabbitMQ, BullMQ, webhooks with retries).
- Does not apply: synchronous request handlers whose client does not retry; those follow the HTTP idempotency rules of the API pattern.

## Rules

1. Treat every message as possibly delivered twice and out of order — because every mainstream broker redelivers after a timeout or a crash.
2. Derive the idempotency key from the message's business identity (`orderId:event`), never from the broker's delivery ID — because a redelivered or republished message gets a new delivery ID.
3. Record the key and apply the side effect in one transaction; if the side effect is external, record the key first with a pending state and complete it after — because checking and then acting in two steps lets two deliveries both act.
4. Classify every failure as retryable or not; send non-retryable ones to the dead-letter queue at once — because retrying a validation error only delays the alert and burns capacity. [check: test: a malformed message is dead-lettered after one attempt] [check: Biome: no throwing of plain `Error` in handlers]
5. Keep the visibility timeout (or lock duration) longer than the handler's worst-case run time, and extend it for long jobs — because a message that becomes visible mid-processing is processed twice concurrently.
6. Alert on dead-letter queue depth above zero — because a dead-letter queue nobody watches is data loss with extra steps.

## Example

The step that is easy to get wrong: recording the key and doing the work atomically.

```ts
await db.transaction(async (tx) => {
  const inserted = await tx.processedMessages.insertIfAbsent({ key: `${msg.orderId}:paid` });
  if (!inserted) return; // a previous delivery already did the work
  await tx.invoices.create(invoiceFor(msg));
});
```

A reference implementation in a product repository can be cited instead, by backticked path: `pnpm check` keeps the path valid.

## Signs of legacy

- Handlers with no lookup of a processed-messages table or an idempotency key.
- `catch (e) { logger.error(e) }` with no rethrow inside a consumer.
- Retry counts or backoff written by hand inside handler code instead of broker configuration.
