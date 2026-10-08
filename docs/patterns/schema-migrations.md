---
type: pattern
---
# Schema migrations

How schema, indexes and search mappings change in environments that keep serving traffic while old and new code run side by side.

## When it applies

- Applies: every change to tables, columns, constraints, indexes, collections, search mappings or key schemas, on every engine ([house conventions](house-conventions.md) rule 13).
- Does not apply: changes to rows that are business operations (they go through the application); local prototyping databases nobody else uses.

## Rules

### Compatibility

1. Every migration is compatible with the code already running and with the code about to run: changes ship as expand (additive) and contract (removal) steps in separate releases — because during a rolling deploy, and after an application rollback, both versions hit the same schema.
2. Renames, type changes, drops and tightened constraints are never one step: add the new shape, write both, backfill, switch reads, stop writing the old shape, then drop it one release after no deployed code uses it — because a one-step rename breaks every instance still running the old code.
3. A change spanning several databases or engines has no atomic commit; order its steps so that every intermediate state works — because "roll back the legs that succeeded" fails exactly when it is needed.

### Running

4. Migrations run in their own pipeline step, after the build and before the new version takes traffic, never at application boot ([delivery pipeline](delivery-pipeline.md)) — because every instance racing to migrate on start is how schemas drift and deploys deadlock.
5. A failed migration stops the deploy and leaves the old version serving — because rule 1 makes the old code safe on the partly expanded schema, and pushing on makes it worse.
6. The record of applied migrations lives in the target database (a migrations table), never in files in the repository — because a file cannot tell staging from production, and it does not change when someone restores a backup.
7. Only one runner applies migrations to a database at a time, enforced by a lock the database releases on disconnect (a session advisory lock) or by a pipeline concurrency group, never by a time-limited lease — because a paused runner whose lease expired keeps running DDL alongside the next one.
8. Applied migrations are never edited, renamed, reordered or deleted; a mistake is fixed by a new migration — because environments that already applied the old text silently diverge from those that apply the new one. [check: test: CI fails when a migration file that exists on the main branch changes, or a new one sorts before the latest on main]
9. Production is fixed forward: down migrations may exist for development, but production recovery is a new forward migration or a restore — because a down step that drops a column destroys the data written since it was added.

### Locks and long work

10. Every DDL statement runs with a short `lock_timeout` and a `statement_timeout`, and the runner retries lock timeouts with backoff — because an `ALTER` waiting for its lock queues every later query on that table behind it.
11. Indexes on existing tables are built online (`CREATE INDEX CONCURRENTLY` in PostgreSQL, outside a transaction), and a failed build's invalid index is dropped before retrying — because a plain index build blocks writes for its whole duration.
12. Constraints are added unvalidated and validated in a later statement (`NOT VALID` then `VALIDATE CONSTRAINT`); `NOT NULL` comes from a validated `CHECK (col IS NOT NULL)` before `SET NOT NULL` — because validating while holding the strongest lock blocks the table for a full scan.
13. Changes that rewrite a table (most column type changes, volatile defaults) become a new column plus a backfill — because a rewrite holds an exclusive lock for minutes on a large table.
14. Data backfills are separate from schema migrations: a job that works in batches by key, throttles, records progress, is idempotent and can resume — because one giant `UPDATE` holds locks, bloats the table, lags replicas and cannot be paused.

### Sources of migrations

15. ORMs and schema tools may generate migration files, which are reviewed and committed; they never apply schema directly to a shared environment (`synchronize`, `db push`, `autoIndex`) — because generated DDL that nobody reads is how a column rename becomes a drop and an add.
16. A legacy database adopts migrations with a baseline that captures its current schema and is recorded as applied in every existing environment — because replaying history nobody has fails, and recreating a live schema is not an option.
17. An emergency change made by hand is committed the same day as a migration written to be safe to re-run (`IF NOT EXISTS`) or recorded as applied — because otherwise the runner applies it again or the next environment never gets it.
18. Every migration chain is applied from empty (or from the baseline) to the real engine in CI, and the repository tests run against the result ([testing](testing.md)) — because a migration that only ever ran on a developer's laptop fails in production.

### Fan-out across schemas or databases

19. With a schema or database per tenant ([multi-tenancy](multi-tenancy.md)), each migration is applied to every tenant by the same runner, recorded in each tenant's own ledger, written to be safe to re-run, and resumable from the first unmigrated tenant, with a report listing the tenants that failed; expand/contract still holds across tenants — because a fan-out that stops halfway with no record leaves tenants on unknown schemas, and while it runs the new code meets tenants on both sides of the migration.

## Example

Renaming `customers.email` to `email_address` without downtime: four releases, each compatible with the one before.

```sql
-- Release 1 (expand). Code writes both columns, reads `email`.
ALTER TABLE customers ADD COLUMN email_address text;

-- Backfill job, repeated until it updates nothing (rule 14).
UPDATE customers SET email_address = email
WHERE id IN (SELECT id FROM customers
             WHERE email_address IS NULL AND email IS NOT NULL
             ORDER BY id LIMIT 1000);

-- Release 2. Backfill finished; code reads `email_address`, still writes both.
-- Release 3. Code writes only `email_address`; no deployed version reads `email`.

-- Release 4 (contract). Its migration runs while release 3, which ignores `email`, serves.
ALTER TABLE customers DROP COLUMN email;
```

Dropping in release 3 is the usual mistake: its migration runs while release 2, which still writes `email`, is serving.

## Signs of legacy

- `synchronize: true`, `autoIndex: true`, `createIndex(`, `CREATE TABLE IF NOT EXISTS` or `indices.create` in startup code; migrations invoked from `main.ts`.
- `RENAME COLUMN`, `DROP COLUMN` or `ALTER COLUMN ... TYPE` in the same release as the code change.
- `CREATE INDEX` without `CONCURRENTLY` on an existing table; `ADD CONSTRAINT` without `NOT VALID`.
- `UPDATE` without a `WHERE` batch bound inside a migration file.
- Migration state or locks kept in JSON files; `git log` showing edits to merged migrations.

## Notes

### PostgreSQL

- DDL is transactional, except `CREATE INDEX CONCURRENTLY` and a few others, which need a migration of their own that runs outside a transaction.
- `pg_advisory_lock(<key>)` is held by the session and released on disconnect: the right runner lock.
- `ADD COLUMN` with a constant default is instant since PostgreSQL 11; `SET NOT NULL` skips the scan when a validated `CHECK (col IS NOT NULL)` exists, since PostgreSQL 12.
- After a failed concurrent build, find leftovers with `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid`.

### MySQL

- DDL is not transactional and commits implicitly: one statement per migration.
- Request `ALGORITHM=INSTANT` or `ALGORITHM=INPLACE, LOCK=NONE` explicitly, so the statement fails instead of silently copying the table.
- Metadata locks queue behind long transactions; set `lock_wait_timeout` low for DDL. Very large tables need an online schema-change tool (trigger- or binlog-based).

### MongoDB

- Indexes come from migration scripts; set `autoIndex: false` in Mongoose and never call `createIndex` at boot.
- Index builds hold an exclusive lock only briefly at start and end, but a unique index build fails on existing duplicates: deduplicate first.
- Hide an index (`hideIndex`) and watch query plans before dropping it; unhiding is instant, rebuilding is not.
- Shape changes are expand/contract at document level: code reads both shapes, a batched backfill rewrites by `_id` range, and validation rules tighten last.

### Elasticsearch / OpenSearch

- Mappings are migrations too: adding a field to an existing mapping is additive; changing a field's type needs a new versioned index (`<name>-v<N>`).
- Rebuild the new index from the source of truth and swap the alias in one `_aliases` request; capture writes made during the rebuild by dual-writing or replaying from a checkpoint ([read models and search](read-models-and-search.md)).

### DynamoDB

- Attributes have no schema: code reads both shapes, and a backfill uses a rate-limited, segmented `Scan` with conditional writes so it never overwrites newer items.
- Table key schemas cannot change: a new key design means a new table and a migration of the data. Global secondary indexes can be added online and backfill on their own.

### Tools

- node-pg-migrate: JavaScript or SQL migrations, a migrations table in the database and a lock by default; keep the lock enabled.
- Prisma Migrate: `prisma migrate dev` generates in development; `prisma migrate deploy` applies in the pipeline. Edit the generated SQL for concurrent index builds and expand/contract steps.
- Drizzle Kit: `drizzle-kit generate` writes SQL to review and commit; apply it with `drizzle-kit migrate` or the runtime migrator; `push` is for local prototyping only.
- Flyway: versioned `V<n>__<description>.sql` files, a history table, and checksum validation that fails on edited migrations.
- Atlas: declarative schema diffed into versioned files, an integrity sum file, and linting that flags destructive changes.
