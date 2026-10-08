---
type: pattern
---
# Multi-tenancy

How a system that serves several isolated customers (tenants) keeps each one's data, load and identity apart, for repositories that opt in through their architecture map ([house conventions](house-conventions.md) rule 27).

## When it applies

- Applies: systems where one deployment serves several customers whose data must never mix. In these systems the "caller's scope" of every other pattern is the tenant.
- Does not apply: single-customer systems, and per-user ownership inside one customer, which is authorization ([authentication and authorization](authentication-and-authorization.md)).

## Rules

### The model

1. Choose the tenancy model once and record it in the architecture map: shared tables with a tenant column (the default for many small tenants), a schema per tenant (tens to hundreds of tenants needing per-tenant customisation), or a database or account per tenant (regulatory isolation, very large tenants) — because each model changes how migrations, backups, limits and offboarding work, and mixing them by accident is the worst of all.
2. A hybrid (shared by default, dedicated for large or regulated tenants) routes through one tenant directory that maps each tenant to its location — because location logic scattered through the code sends a tenant's data to the wrong place after a move.

### Resolving and passing the tenant

3. The tenant is resolved only from verified identity at the boundary (a token claim, a session, a verified domain mapping), never from a body, query parameter or header the client controls without checking membership — because a tenant id the client can choose is a key to every tenant.
4. The resolved tenant travels as an explicit, typed argument to every repository, cache, search, storage and lock call, and inside the payload of every queued message ([house conventions](house-conventions.md) rule 22) — because ambient context is lost across queues and timers, and a forgotten parameter should fail to compile. [check: tsc: repository, cache and search interfaces take a `TenantScope` parameter that cannot be built from a plain string outside the boundary]
5. Consumers of a queued message re-check that its tenant exists and is active before acting — because tenants are suspended and offboarded while their messages wait in queues.
6. Cross-tenant operations (support tooling, platform reporting) use a separate, audited path with an elevated identity, never a repository call with the tenant left out — because a code path that works without a tenant is one bug away from leaking every tenant.

### Keys, indexes and predicates

7. The tenant leads every ordered key: compound indexes, unique constraints (`UNIQUE (tenant_id, external_id)`), search routing, object storage prefixes, and entity ids that are unique only per tenant; cache and lock keys carry it in the scope position of [house conventions](house-conventions.md) rule 24 — because an index without the tenant first scans other tenants' rows, and a key without it collides with them.
8. Every query appends the tenant predicate after the caller's filters, writes included, and a miss answers not-found ([repositories](repositories.md)) — because filters merged later can override the tenant, and a different answer reveals other tenants' ids.
9. Shared PostgreSQL tables also enforce row-level security as defence in depth: policies compare the row's tenant with a setting made per transaction, the application role does not own the tables and lacks `BYPASSRLS`, and `FORCE ROW LEVEL SECURITY` is on — because one missed predicate in application code then returns nothing instead of another tenant's data.
10. Every repository, cache and search adapter has an isolation test with two tenants sharing an external id: reads, updates and deletes for one never see or change the other, and a caller filter naming the other tenant is ignored — because isolation that is not tested per adapter breaks in the one adapter nobody checked. [check: test: the two-tenant isolation suite runs for every adapter]

### Fairness and operations

11. Limits apply per tenant: request rate ([HTTP idempotency and rate limits](http-idempotency-and-rate-limits.md)), storage, expensive queries, and queued work, which is made fair by a per-tenant message group or partition key, or by a per-tenant concurrency limit at the consumer — because one tenant's import otherwise fills the queue and slows every other tenant down.
12. Scheduled and batch work runs as one job per tenant, not one loop over all tenants ([scheduled jobs](scheduled-jobs.md)) — because one tenant's failure or size otherwise blocks or delays all the others.
13. Logs and traces carry the tenant as an opaque id, never a name; a metric may carry the tenant id as a label only when the set of tenants is small and bounded (known in advance, not growing with sign-ups), and otherwise the tenant goes to logs and traces only ([observability](observability.md)) — because tenant names are business data, and an unbounded label explodes metric storage.
14. Offboarding deletes a tenant's data from every store, or drops its dedicated database ([data lifecycle](data-lifecycle.md)): ordered stores (tables, indexes, object prefixes) delete by tenant range; cache entries are removed through a per-tenant key set or left to expire, never by scanning key prefixes — because offboarding by searching for rows is slow and misses copies, and prefix scans over a cache block it and miss keys in a cluster.

## Example

Row-level security set per transaction. A session-level `SET` is the usual mistake: the pooled connection keeps it for the next request, which may belong to another tenant.

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY; -- applies to the table owner too
CREATE POLICY orders_tenant ON orders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- In every transaction, as its first statement:
BEGIN;
SELECT set_config('app.tenant_id', $1, true); -- true: local to this transaction
-- ... queries ...
COMMIT;
```

When the setting is absent the policy compares with `NULL` and matches no rows: a forgotten setting fails closed.

## Signs of legacy

- `req.body.tenantId`, `req.query.tenant` or an `x-tenant-id` header read without a membership check.
- Repository methods with an optional tenant parameter, or a tenant field inside query DTOs.
- Indexes or object keys that do not start with the tenant; cache keys without it.
- Admin endpoints that call ordinary repositories without a tenant.
- `SET app.tenant_id` (session level) instead of `set_config(..., true)` or `SET LOCAL`.
- Cron jobs that loop over every tenant in one run.

## Notes

### PostgreSQL

- Row-level security policies run on every row: index `tenant_id` first and keep policy expressions simple.
- With a transaction-mode pooler (PgBouncer, RDS Proxy), only transaction-local settings are safe.
- Schema per tenant uses `search_path` set per transaction, and migrations run once per schema: the fan-out follows [schema migrations](schema-migrations.md) rule 19.

### MongoDB

- There is no row-level security: the repository's appended predicate and the isolation tests are the control.
- Every compound index starts with the tenant field; a database per tenant multiplies connections and collections, so keep it for few large tenants.

### Elasticsearch / OpenSearch

- Shared indexes need a tenant filter added by the adapter on every query, and document ids that include the tenant ([read models and search](read-models-and-search.md)).
- Filtered aliases per tenant (an alias with a filter and a routing value) give each tenant a narrow view and keep its documents on one shard.
- An index per tenant stops scaling early because every shard costs memory; use it only for few large tenants.

### Redis

- The tenant sits in the scope position of every cache key (`product:v3:t42:7`); keys that must share a slot follow [caching](caching.md) rule 3.
- Remove a tenant's cache entries through a per-tenant set of its keys, or let them expire; never `KEYS` or prefix `SCAN`, which blocks or visits every node of a cluster.
- Dedicated tenants can get their own users with access control lists restricted to their key patterns.

### S3

- Prefix every object key with the tenant (`<tenant>/...`); per-tenant credentials can then be limited by prefix conditions in IAM policies.
- Issue pre-signed URLs only after checking that the object's prefix matches the caller's tenant.
- Lifecycle rules and offboarding deletes work per prefix; a bucket per tenant runs into account bucket limits.
