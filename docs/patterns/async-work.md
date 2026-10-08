---
type: pattern
---
# Async work

How work leaves the request path and runs in workers safely, whatever the queue or broker.

## When it applies

- Applies: any job, message or event consumed by a worker: queues, topics, event buses, stream consumers, function triggers.
- Does not apply: work inside the repository's latency budget on one database, which stays synchronous ([house conventions](house-conventions.md) rules 18 and 19); publishing from a business write ([outbox](outbox.md)); multi-step processes ([state machines and workflows](state-machines-and-workflows.md)); clock triggers ([scheduled jobs](scheduled-jobs.md)).

## Rules

### Boundaries

1. A request whose work exceeds the repository's declared latency budget enqueues and answers with a status or a resource to poll, never the result — because a long request times out halfway and gives the client no safe way to retry.
2. A processor turns the envelope's payload into a validated command and makes exactly one call to the module's application service (facade); it never imports handlers or repositories ([house conventions](house-conventions.md) rule 26) — because business logic leaks into transport code and the seam becomes untestable. [check: dependency-cruiser: processors may import only the application service of their module]
3. Domain code imports no broker, queue or cloud SDK — because the domain stops being testable without infrastructure. [check: dependency-cruiser: domain folders may not import bullmq, @aws-sdk/*, kafkajs, amqplib]
4. Every message uses the shared envelope built by one constructor per producer, and consumers dispatch on `type` ([house conventions](house-conventions.md) rule 22) — because hand-built payloads break consumers during a rolling deploy. [check: dependency-cruiser: only the producer module may import the broker client]

### Duplicates and leases

5. Treat every delivery as possibly duplicated, delayed and reordered; no document or test may claim exactly-once delivery, only effects applied once — because every broker redelivers after a timeout, a crash or a rebalance.
6. Use the envelope's meaning-based `idempotencyKey` ([house conventions](house-conventions.md) rule 8), never the broker's message or delivery id — because a redelivered or republished message gets a new delivery id.
7. Before executing, claim the key with a lease tied to the owner; keep the lease alive with a heartbeat for as long as the work runs, and keep the broker's visibility timeout, lock or ack deadline longer than the worst-case run time (or extend it the same way) — because an expired lease or a message that becomes visible mid-run is executed twice at the same time. [check: test: a job running past the lease length is not executed by a second worker]
8. A claim that finds the key `completed` is a successful no-op; one that finds it in progress under another owner is retried later; a target state that is already reached is a no-op ([house conventions](house-conventions.md) rule 10) — because duplicates are normal traffic, not failures.
9. Every non-idempotent side effect leaves a durable receipt: written in the same transaction as the effect, or the provider's own idempotency key, or an authoritative read-back; retries and reconcilers check the receipt before executing — because a lease that expires between the effect and its bookkeeping turns uncertainty into a second effect.
10. When an earlier attempt may have run and no receipt can settle it, quarantine the job for reconciliation instead of executing again ([outbound calls](outbound-calls.md) owns the unknown-outcome rule) — because "probably did not run" is how customers get charged twice. [check: test: a claim over an expired lease with no receipt and no read-back quarantines]
11. If the side effect succeeded but recording completion failed, keep the lease and raise a retryable error; never release it and never mark the key failed — because releasing after a success invites re-execution.

### Failures and dead letters

12. Classify failures at the worker boundary only, from the error's `retryable` flag, treating unclassified errors as retryable ([house conventions](house-conventions.md) rules 1 and 3, [errors](errors.md)) — because retry decisions scattered through handlers produce retry storms and swallowed failures.
13. Retry defaults are configuration, overridable per queue: 5 attempts, exponential backoff with full jitter, each delay capped at 5 minutes ([configuration and secrets](configuration-and-secrets.md)) — because retries hard-coded per handler drift apart, and synchronized retries without jitter hit a recovering dependency all at once.
14. Non-retryable failures (invalid envelope, illegal transition) go to the dead-letter queue at once, without consuming retries — because retrying a poison message only delays the alert and blocks capacity.
15. Every dead-lettered message is reported once at the boundary ([house conventions](house-conventions.md) rule 4); in addition, every dead-letter queue has a retention period longer than the time to react, an alert on depth above zero, and a re-drive tool that runs as a dry run by default — because an unwatched dead-letter queue is silent data loss, and an unsafe re-drive replays the wrong jobs.
16. Re-driving a job clears its cached terminal state in the idempotency store first, explicitly and logged — because otherwise the re-driven job hits the cached failure and dead-letters again.

### Ordering, runtime and scale

17. Assume no ordering unless the transport is keyed by the entity that needs it (FIFO group, partition key) and the consumer processes one message per key at a time — because concurrent consumers reorder even a FIFO stream.
18. On shutdown, stop taking new work, finish or release in-flight jobs within the platform's stop timeout, then exit — because a killed worker leaves locks to expire and jobs to run twice. [check: test: SIGTERM during a job completes or releases it]
19. Scale consumers on backlog depth or the age of the oldest message, never on CPU alone, and cap concurrency at what downstream systems can take ([outbound calls](outbound-calls.md)) — because I/O-bound workers idle at low CPU while the queue grows.
20. Log each job's start and outcome with `correlationId`, `type`, attempt and the key's hash, never the payload ([observability](observability.md)) — because a job nobody can trace by correlation id cannot be debugged, and payloads carry personal data.

## Example

The step that is easy to get wrong: execution failure and completion failure take different paths.

```ts
const claim = await idempotency.claim(key, ownerId, { leaseMs });
if (claim.state === 'completed') return;                  // duplicate: no-op
if (claim.state === 'in-progress') throw new LeaseBusyError(); // retryable
if (claim.state === 'failed') throw new PriorFailureError(key);         // not retryable
if (await receipts.find(key)) return idempotency.complete(key, claim.token);

let receipt: Receipt;
try {
  receipt = await invoices.issueInvoice(IssueInvoiceCommand.parse(envelope.payload), { key });
} catch (error) {
  if (isNonRetryable(error)) await idempotency.fail(key, claim.token, codeOf(error));
  else await idempotency.release(key, claim.token);
  throw error;
}
// Outside the catch: the effect happened. A failure here keeps the lease and retries.
await idempotency.complete(key, claim.token, receipt.reference);
```

Moving `complete` inside the `try` would release the lease after a successful effect, and the next attempt would issue the invoice again.

## Signs of legacy

- Controllers that `await` slow work (exports, emails, third-party calls) before responding.
- `queue.add(` or `SendMessageCommand` without an idempotency key; keys built from `job.id` or `MessageId`.
- Processors importing `*.repository` or `*.handler`; domain files importing `bullmq` or `@aws-sdk/`.
- `catch (e) { logger.error(e) }` with no rethrow in a consumer; retry loops written inside handlers.
- Dead-letter queues with no alarm; no `SIGTERM` handler in the worker entry point.
- Autoscaling on `CPUUtilization` for a queue worker.

## Notes

### BullMQ

- Redis must run with `maxmemory-policy noeviction`; any eviction policy silently deletes jobs. Replication is asynchronous, so a failover can lose recently added jobs: keep the outbox row or a reconciler for work that must not be lost.
- Worker connections need `maxRetriesPerRequest: null`; producer connections can keep a finite value so enqueueing fails fast.
- A worker renews its job lock while the event loop is free; CPU-bound work blocks renewal, the job is declared stalled and runs again (`lockDuration`, `maxStalledCount`). Run CPU-heavy processors sandboxed.
- `jobId` deduplicates only while the job is retained; set `removeOnComplete` and `removeOnFail` by age and keep the consumer-side claim anyway. Custom ids must not be plain integers, so use a hash of the key.
- Throw `UnrecoverableError` for non-retryable failures; set `attempts` and exponential `backoff` as shared defaults. The failed set is the dead-letter queue: bound it with `removeOnFail` and alert on its count.
- `concurrency` above 1, or several workers, gives no ordering. Call `worker.close()` on `SIGTERM`.

### SQS standard

- At-least-once with best-effort order. A redrive policy with `maxReceiveCount` sends repeated failures to a dead-letter queue; alarm on its depth.
- Extend long jobs with `ChangeMessageVisibility` as the heartbeat. Use long polling (`WaitTimeSeconds` up to 20).
- Put large payloads in object storage and send a reference.

### SQS FIFO

- `MessageGroupId` is the unit of ordering: use the entity id, never a constant, or the whole queue becomes serial.
- The deduplication id only covers a five-minute window; it does not replace the consumer's claim.
- A failing message blocks its group until `maxReceiveCount` moves it to the (FIFO) dead-letter queue: keep that count low.

### SNS fan-out

- Each subscriber gets its own SQS queue; do not wire critical consumers straight to a function.
- Use raw message delivery and filter policies on the subscription instead of discarding in code; give each subscription a redrive policy.
- SNS FIFO topics deliver only to SQS FIFO queues.

### EventBridge

- For domain events between services, not for work queues. `detail-type` carries the envelope `type`; version the `detail` schema.
- Delivery is at-least-once; give every target a retry policy and a dead-letter queue.
- Archive and replay re-deliver old events, so consumers must already be idempotent.

### Kafka

- The partition key is the unit of ordering and parallelism. Commit offsets only after the effect is recorded.
- Exceeding `max.poll.interval.ms` triggers a rebalance and redelivery: it is the lease, so size batches to stay under it.
- Idempotent producers and transactions cover Kafka writes only, never external side effects. Use retry topics and a dead-letter topic rather than blocking a partition.
- Register schemas with a compatibility rule and check it in CI.

### RabbitMQ

- Manual acknowledgements and publisher confirms; quorum queues for durability.
- Set a prefetch limit; the consumer ack timeout is the lease.
- Dead-letter exchanges for failures, a delivery limit on quorum queues against requeue loops; never requeue in a tight loop.

### Lambda event sources

- SQS: enable `ReportBatchItemFailures` so one bad message does not retry the batch; set the visibility timeout to at least six times the function timeout; cap the mapping's maximum concurrency to protect downstream systems.
- Kinesis and DynamoDB Streams: a failing record blocks its shard; set `BisectBatchOnFunctionError`, a maximum retry count and record age, and an on-failure destination.
- Asynchronous invocations retry on their own; configure an on-failure destination and keep the handler idempotent.
