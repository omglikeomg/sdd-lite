---
type: pattern
---
# Repositories

How application code reads and writes a database: through one interface per aggregate that owns every query, every scope predicate and every concurrency check.

## When it applies

- Applies: every module that persists data in a database, whatever the engine or the ORM.
- Does not apply: schema changes ([schema migrations](schema-migrations.md)), caches in front of a repository ([caching](caching.md)), search indexes and projections ([read models and search](read-models-and-search.md)), one-off scripts that run through the migration runner.

## Rules

### The boundary

1. Domain and application code depend on a repository interface the domain defines; only its implementation, under `infrastructure/` ([house conventions](house-conventions.md) rule 26), imports the driver or ORM client — because driver types in business code make storage impossible to fake, swap or review in one place. [check: dependency-cruiser: only `infrastructure/` modules may import database drivers and ORM clients]
2. Repositories return domain objects mapped from storage names ([house conventions](house-conventions.md) rule 14), never driver rows, ORM entities or documents with methods, and leave soft-deleted rows out by default ([data lifecycle](data-lifecycle.md)) — because callers that hold an ORM entity trigger lazy loads and saves from anywhere, and a filter each caller must remember is a filter someone forgets.
3. Each table or collection has one owning module that writes it; other modules read through that module's interface or a read model — because two writers enforce two different sets of invariants. [check: dependency-cruiser: a module may not import another module's repository implementation]
4. Caller filters are translated through an allowlist of fields and operators; nothing from the wire reaches the query as an operator, identifier or raw fragment, and `LIKE` wildcards and regular expressions built from input are escaped — because pass-through filters are operator injection and unescaped patterns are a denial of service. [check: test: a filter carrying `$where`, `$regex` or a column name outside the allowlist is rejected]

### Scope and identity

5. Every method takes the caller's scope as a separate, typed argument resolved from verified identity, never from a DTO field, and appends it to every predicate after the caller's filters, including updates, upserts and deletes ([multi-tenancy](multi-tenancy.md)) — because one write without the predicate overwrites someone else's data, and filters merged after the scope can override it. [check: test: two scopes sharing an external id; reads, updates and deletes for one never see or touch the other]
6. Rows have a generated internal id plus, when data comes from another system, an external id unique per scope (`UNIQUE (scope, external_id)`); the external id is required, immutable and never defaulted — because a global unique key collides across scopes, and a defaulted integration key silently breaks idempotent sync.
7. An update or delete that matches zero rows within the caller's scope answers not-found, without saying whether the row exists elsewhere — because a different answer leaks which ids other scopes own.

### Concurrency

8. Every read-modify-write carries a version: the update matches `id`, scope and the version it read, and increments it; zero affected rows is a typed `<entity>-version-conflict` error — because without it the last writer silently discards the first one's change. [check: test: two concurrent updates from the same version; exactly one wins]
9. A version conflict from a user edit answers 409 with the current version; one inside a background command re-reads and re-applies the command a bounded number of times — because users must see what changed, while jobs can re-derive their decision.
10. Upserts are one atomic statement on the unique key (`ON CONFLICT`, `ON DUPLICATE KEY`, `upsert: true`, a conditional put), never read-then-insert; a duplicate-key error from two concurrent upserts is retried once ([house conventions](house-conventions.md) rule 11) — because read-then-insert races, and the losing upsert of a race is harmless.
11. Never call another service, a broker or the network inside a transaction; record intent in an outbox row instead ([outbox](outbox.md)) — because locks stay held for the remote call's latency, and the remote effect cannot roll back.
12. When a connection drops during `COMMIT`, or a write's acknowledgement is lost, the outcome is unknown: retry only writes that are idempotent by construction (natural-key upsert, version check, idempotency key stored in the same transaction), otherwise surface an unknown-outcome error for reconciliation (the principle of [outbound calls](outbound-calls.md) rule 11, applied to the database) — because blindly retrying a non-idempotent insert after an ambiguous commit applies it twice.
13. A connection whose transaction failed to roll back is destroyed, not returned to the pool, and a cleanup failure never replaces the original error — because the next caller inherits a half-open transaction, and the real cause disappears from the logs.

### Bounded work

14. Every list query has a limit, paginated by cursor over an ordering that ends in a unique tiebreaker, with a capped page size ([house conventions](house-conventions.md) rule 23) — because unbounded queries take down the database the day a scope gets large. [check: test: pages over rows that share the sort value neither skip nor repeat]
15. Database pools follow [outbound calls](outbound-calls.md) rules 18 to 20 (maximum, acquire timeout, total budget, bulkheads); in addition every connection gets a server-side statement timeout, and the budget keeps headroom for the migration runner and operators — because a query nobody bounds holds its connection and locks indefinitely, and a deploy that cannot connect cannot migrate.
16. Every query path a request uses is backed by an index whose leading columns match its equality filters (scope first when there is one), and a test asserts the plan for the main list queries — because a missing index is invisible until the table grows. [check: test: `EXPLAIN` or `explain()` shows an index scan, not a full scan, for each list query]

### Errors and tests

17. The implementation maps driver errors to typed errors with an explicit `retryable` flag ([errors](errors.md)): constraint violations are not retryable, serialization failures, deadlocks and lock timeouts are retryable as a whole transaction, connection errors follow rule 12 — because retrying a constraint violation loops forever, and retrying one statement of a failed serializable transaction is wrong.
18. Repository tests run against the real engine (a container) with the schema built by the migrations; in-memory imitations are not accepted for concurrency, plans or constraints ([testing](testing.md)) — because the bugs this pattern prevents live exactly where imitations differ.

## Example

The transaction helper is where the connection leak and the masked error usually hide (node-postgres shown).

```ts
export async function withTransaction<T>(pool: Pool, work: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT'); // a connection error here is an unknown outcome (rule 12)
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => {
      broken = rollbackError; // connection state unknown: do not reuse it
    });
    throw error; // the original error, never the rollback's
  } finally {
    client.release(broken); // a truthy argument destroys the client instead of pooling it
  }
}
```

## Signs of legacy

- Driver or ORM imports (`from 'pg'`, `mongoose`, `@prisma/client`) in services, resolvers or controllers.
- `UPDATE ... WHERE id = $1` with no version or scope predicate; `.save()` after a `find` with no version check.
- `findMany`, `find({})` or `SELECT` with no `LIMIT`; `skip`/`OFFSET` on public lists.
- `findFirst` or `SELECT` followed by `INSERT` to implement an upsert.
- `fetch(`, SDK or broker calls inside a transaction callback.
- `client.release()` with no argument in a `catch` path; retries wrapped around `COMMIT`.

## Notes

### PostgreSQL

- SQLSTATE mapping: `23505`, `23503`, `23502`, `23514` not retryable; `40001`, `40P01`, `55P03` (lock timeout), `57014` (statement timeout) retryable as a whole transaction; class `08` is a connection failure.
- Keyset: `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT $3`, backed by an index on `(scope_id, created_at DESC, id DESC)`.
- Set `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` per role or pool.
- `READ COMMITTED` plus version checks or `SELECT ... FOR UPDATE` covers most writes; `SERIALIZABLE` requires a whole-transaction retry loop.

### MySQL / MariaDB

- Default isolation is `REPEATABLE READ` with gap locks: range updates lock more than expected and deadlock more often; keep transactions short.
- Errors: `1062` duplicate key, `1213` deadlock, `1205` lock wait timeout. Use `utf8mb4` and strict `sql_mode`.
- `INSERT ... ON DUPLICATE KEY UPDATE` reports 1 affected row for an insert and 2 for an update; do not read it as a version check.

### MongoDB

- Duplicate key is error code `11000`. Multi-document transactions need a replica set or sharded cluster; single-document writes are atomic without one.
- Optimistic concurrency: `updateOne({ _id, scope, version }, { $set, $inc: { version: 1 } })` and check `matchedCount`. Mongoose's `optimisticConcurrency` option covers `save()` only.
- Upserts put identity fields in `$setOnInsert` and mutable fields in `$set`, never the same path in both.
- With retryable writes (on by default in current drivers), the driver retries a retryable write once internally; an application resend after an ambiguous result still follows rule 12.
- Keyset with `{ createdAt: -1, _id: -1 }`, never `skip`. Run with `autoIndex: false`; indexes come from migrations.

### DynamoDB

- Design keys from access patterns; the scope leads the partition key. `Scan` never serves a request.
- Concurrency and upserts are `ConditionExpression`s; `ConditionalCheckFailedException` is the conflict. `TransactWriteItems` is capped at 100 items.
- Paginate with `ExclusiveStartKey`; `Limit` applies before the filter expression, so pages can come back short or empty while more data exists.
- Reads from a global secondary index are eventually consistent; read-your-writes needs the base table.

### SQLite

- Enable WAL and a `busy_timeout`, and turn `foreign_keys` on for every connection (it is off by default).
- One writer at a time: start write transactions with `BEGIN IMMEDIATE` to avoid upgrade deadlocks.

### ORMs (Prisma, Drizzle, TypeORM)

- The ORM client lives inside the repository implementation; schema changes go through generated, reviewed migrations, never `prisma db push`, `drizzle-kit push` or `synchronize: true` against a shared environment.
- Prisma: `P2002` unique violation, `P2025` record not found, `P2034` write conflict or deadlock (retryable); give interactive transactions a timeout.
- TypeORM's `@VersionColumn` increments the version but `save()` does not compare it; put the version in the update's `WHERE` yourself.
- Watch for N+1 queries from relation loading; load relations explicitly per query.

### Read replicas and connection budgets

- Route reads to replicas per call site, only where stated lag is acceptable; reads that follow a write in the same flow and every read-modify-write go to the primary ([data lifecycle](data-lifecycle.md)).
- Serverless pool sizing follows [outbound calls](outbound-calls.md); in front of PostgreSQL or MySQL that means an external pooler (PgBouncer, RDS Proxy).
- Transaction-mode poolers break session state (`SET`, advisory locks, temporary tables, some prepared statements); RDS Proxy pins the connection instead, which defeats pooling. Use `SET LOCAL` and transaction-scoped locks.
