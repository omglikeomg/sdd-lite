---
type: pattern
---
# Outbox

How a business write and the message announcing it become atomic, and how those messages reach the broker at least once.

## When it applies

- Applies: any write that must eventually produce a job or event, where the write lives in a transactional database.
- Does not apply: fire-and-forget signals nobody depends on; consumers of messages (see [async work](async-work.md)); a store with no transactions and no change log, which needs its own delivery design rather than a weakened outbox.

## Rules

### Writing

1. Insert the outbox row in the same transaction as the business change, or capture the change from the database log; never publish from the write path and never after commit ([house conventions](house-conventions.md) rule 15) — because a crash between the write and the publish loses the message or announces a change that rolled back. [check: dependency-cruiser: modules that write through the unit of work may not import the broker client]
2. The row holds the full envelope ([house conventions](house-conventions.md) rule 22) with a unique `idempotency_key`; a conflict counts as "already written" only after comparing the stored payload hash ([house conventions](house-conventions.md) rule 11) — because a blind conflict-is-success hides two different operations sharing a key.

### Claiming

3. A poller claims rows by persisting a random token, its owner id and an expiry in one statement before returning them; a row lock that ends with its transaction is not a claim — because a second poller picks up rows the first is still publishing.
4. A claim is reclaimable only after expiry; long publishes extend it by compare-and-set on the same token — because live work gets stolen and published twice.
5. Mark dispatched, record failure and extend only `WHERE id = $id AND claim_token = $token`; a mismatch is logged as a lost lease and changes nothing — because a stale poller overwrites the new owner's outcome. [check: test: a stale owner cannot mark a reclaimed row]
6. Publish with the row's key (and a broker deduplication id derived from it, where the broker has one), then mark; a publish that succeeds before the mark fails is republished after expiry, and consumers deduplicate — because exactly-once publishing does not exist, and pretending otherwise hides duplicates.

### Failures and backoff

7. Every row has a `next_attempt_at`; a row-specific failure increments `attempts` and pushes `next_attempt_at` out with exponential backoff and jitter, and the claim query only selects rows that are due — because without backoff a failing row is retried on every poll.
8. Broker or network unavailability pauses the poller with its own backoff and does not consume row attempts — because a few minutes of broker outage would otherwise exhaust every row and fail the whole backlog permanently.
9. A row whose error is non-retryable, or whose attempts are exhausted, gets `failed_at` and its error code, is never reclaimed, and is reported once without the payload ([house conventions](house-conventions.md) rule 4, [errors](errors.md)) — because a poison row otherwise loops forever, and payloads carry personal data.
10. Alert on the age of the oldest undispatched row and on any failed row — because a stuck poller looks exactly like a quiet system.

### Guarantees to state, not assume

11. Promise no ordering. If an aggregate needs order, give rows a per-aggregate sequence, publish only the oldest undispatched row of each aggregate, and send them through a transport keyed by that aggregate — because concurrent pollers and consumers reorder everything else.
12. Write down that the producer-side deduplication window equals the outbox retention, and keep the consumer's idempotency records at least as long as the longest possible republish delay — because a duplicate inserted after cleanup, or republished after the consumer forgot the key, runs twice.
13. Once a row is marked dispatched, the message is only as durable as the broker; with a broker that can lose acknowledged writes (asynchronous replication, eviction), keep rows long enough to reconcile against what consumers recorded — because the outbox guarantees the hand-off, not what happens after it.
14. Batch size, claim length, heartbeat interval, maximum attempts, backoff and retention are configuration ([configuration and secrets](configuration-and-secrets.md)) — because these are tuned per workload and constants in services cannot be.
15. Test the claim algorithm against the real database: two concurrent pollers, an expired claim, a stale owner, publish-then-mark failure, and the write rolling back with the business change ([testing](testing.md)) — because in-memory fakes cannot reproduce the races this pattern exists to handle.

## Example

The claim, in PostgreSQL. Stopping at `SELECT ... FOR UPDATE SKIP LOCKED` is the usual mistake: the lock ends when that transaction commits, before anything is published.

```sql
WITH due AS (
  SELECT id FROM outbox
  WHERE dispatched_at IS NULL AND failed_at IS NULL
    AND next_attempt_at <= now()
    AND (claim_expires_at IS NULL OR claim_expires_at < now())
  ORDER BY next_attempt_at, id
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox o
SET claim_token = gen_random_uuid(), claim_owner = $2,
    claim_expires_at = now() + $3::interval
FROM due WHERE o.id = due.id
RETURNING o.*;
-- Supporting index (created in a migration):
-- CREATE INDEX CONCURRENTLY outbox_due ON outbox (next_attempt_at, id)
--   WHERE dispatched_at IS NULL AND failed_at IS NULL;
```

## Signs of legacy

- `save(...)` followed by `queue.add(`, `publish(` or `SendMessageCommand` in the same function, outside a transaction.
- Events emitted in an "after commit" hook or `eventBus.emit(` right after a repository write.
- An outbox table without a unique key, without a claim token, or with a boolean `processing` column.
- `UPDATE outbox SET dispatched_at` without a token predicate; retry loops with no `next_attempt_at`.

## Notes

### PostgreSQL

- Use the claim above; partial indexes keep the due-row scan small as dispatched rows accumulate.
- Delete old dispatched rows in batches from a scheduled job ([scheduled jobs](scheduled-jobs.md)); a huge outbox table bloats and slows the claim.
- `now()` is the transaction start time, so `created_at` is not commit order; another reason not to promise ordering.

### MongoDB

- Multi-document transactions, and change streams, need a replica set or a sharded cluster; a standalone server cannot host this pattern.
- Claim with `findOneAndUpdate` filtered on due, unclaimed or expired documents, sorted by `nextAttemptAt`, setting token, owner and expiry; repeat for a batch.
- As a log-based alternative, a change stream on the outbox collection can publish inserts; persist the resume token after each publish, and size the oplog to cover the longest outage.

### DynamoDB

- Write the item and the outbox item together with `TransactWriteItems`, or skip the outbox item and consume DynamoDB Streams on the business table.
- Streams keep records for 24 hours and order them per item key only; a consumer down longer than that loses changes, so alarm on iterator age.
- Stream-triggered functions follow the Lambda stream rules in [async work](async-work.md) (bisect, retry limits, on-failure destination).

### Debezium (change data capture)

- Reads the database log instead of polling; the outbox event router turns outbox inserts into keyed broker messages, preserving order per aggregate key.
- A PostgreSQL replication slot retains WAL while the connector is down; alert on slot lag before it fills the disk.
- Delivery is still at-least-once after restarts; consumers deduplicate on the envelope key.
- The outbox table can be emptied right after insert (or rows deleted in the same transaction), since the log already holds the event; the deduplication window then lives only with consumers.
