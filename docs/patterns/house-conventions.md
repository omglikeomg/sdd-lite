---
type: pattern
---
# House conventions

The decisions every other pattern shares, stated once; patterns link here instead of restating them, and when a pattern and this page disagree, this page wins and the pattern is fixed.

## When it applies

- Applies: every repository built from this hub's patterns, on every stack.
- Does not apply: code a repository map lists as a known deviation, until it is next changed substantially.

## Rules

### Errors

1. Every error the application throws on purpose is a typed error class with a fixed, stable kebab-case `code` (`<domain>-<thing>-<reason>`, e.g. `order-already-shipped`) and an explicit `retryable` flag, with no default — because a default chosen once is wrong for half the errors, and callers that branch on messages or class names break when either is reworded.
2. Platform codes shared by every repository are fixed: `validation-failed`, `internal-error`, `rate-limit-exceeded`, `idempotency-key-required`, `idempotency-key-conflict`, `idempotency-key-in-progress`, `idempotency-store-unavailable` — because clients hard-code these, and one spelling per meaning is the point of a code.
3. An error nobody classified (a driver timeout, a `TypeError`) is treated as retryable with bounded attempts, then dead-lettered — because unclassified failures are usually transient infrastructure, and the attempt limit stops a real bug from looping.
4. Expected client failures (validation, not found, conflict, forbidden) are logged, never reported to the error tracker. Unexpected failures (5xx) and every dead-lettered message, whether its retries ran out or it was non-retryable, are reported once, at the boundary — because a tracker full of 404s hides the real incident, and a dead letter is work the system promised and did not do.
5. A field validation failure carries `{ "code": "validation-failed", "issues": [{ "path", "code", "message" }] }`, where `path` is the dot-joined field path (`""` for the whole body). JSON transports answer it with 400; GraphQL mutations return the issues as `userErrors { code path message }` in a 200 payload; server actions return `{ ok: false, code: "validation-failed", issues, values }`; HTML transports answer 400 with the form re-rendered — because clients map issues to fields by path, and each transport has one native way to carry them.
6. Any other 4xx answers `{ "code", "message" }`. Error translators keep the status of the framework's own 4xx responses (guards, body parsers, validation pipes) but normalise their body to this shape, or to rule 5 for parse and validation errors — because a rejected request is not a server failure, and one status with two body shapes needs two client helpers.
7. An unexpected failure answers 500 with `{ "code": "internal-error", "correlationId": "…" }` and nothing else (in GraphQL, the same code in `extensions.code`) — because the id finds the log line, and anything more leaks internals.

### Idempotency and duplicates

8. Keys the system derives are built from what the operation means, `<operation>:<entity-id>:<intent>` (e.g. `invoice-issue:ord_42:paid`), stable across every retry and redelivery. They never contain an attempt number, the wall-clock time of an attempt or a random value; a nominal time that identifies an intended run (a schedule tick) is part of the meaning. Parts are separated by `:` and never contain one — because a key that changes on retry deduplicates nothing, and undelimited parts collide.
9. A client-chosen `Idempotency-Key` header value is opaque and stored scoped by principal, the caller's scope and operation. A create that has no entity id yet derives its key as `<operation>:<scope>:<hash of principal and client key>` and allocates the entity id when the claim is made ([HTTP idempotency and rate limits](http-idempotency-and-rate-limits.md)) — because the client owns its retry identity, and the server must still pass one stable key downstream.
10. A command whose target state is already reached is a successful no-op, not an error — because at-least-once delivery makes duplicates normal, and treating them as failures floods dead-letter queues and alerts.
11. A unique-key violation counts as "already done" only after checking that the stored record came from the same operation (same key, same payload hash); a duplicate key raised by two concurrent upserts is retried once — because a blind "duplicate means success" hides real conflicts, and a blind "duplicate means failure" dead-letters a harmless race.
12. Webhooks are deduplicated by the provider's event id; the `Idempotency-Key` header applies to client-initiated `POST` and `PATCH` (and GraphQL mutations) only — because providers do not send the header, and `PUT` and `DELETE` are idempotent by definition.

### Data and state

13. Schema, indexes and search mappings change only through migrations ([schema migrations](schema-migrations.md)); nothing creates tables, indexes or mappings at boot — because every instance racing to change the schema on deploy is how environments drift.
14. Storage uses each database's native naming (snake_case columns in SQL, camelCase fields in document stores); the repository maps them to domain names — because fighting a database's conventions costs more than one mapping layer.
15. Events and outbox rows are written inside the same transaction as the change they describe (or captured from the database log), never after commit — because "after commit" loses the event when the process dies between the two steps.
16. A projection or derived-index write applies only if the source version is newer than the stored one — because re-reads and replays arrive out of order, and a slow worker must not overwrite newer data.
17. State graphs may have cycles; terminal states are leaves with no outgoing transitions — because real lifecycles pause, resume and retry, and what must never happen is mutating a closed record.
18. Work stays synchronous inside one database. It becomes asynchronous only when it exceeds the repository's latency budget or spans databases or services. Choreography is allowed only for strictly linear chains of two or three steps with no branch, timeout or compensation; anything else uses an orchestrator ([state machines and workflows](state-machines-and-workflows.md)) — because asynchrony adds failure modes that must pay for themselves, and a timeout or compensation spread across subscribers cannot be recovered in one place.
19. Each repository declares in its architecture map its latency budget for synchronous requests (one number, e.g. 300 ms at p95) and its server request timeout — because "a few hundred milliseconds" in three places becomes three rules, and leases and deadlines are sized from the timeout.
20. Every schedule names an IANA time zone, and system scheduled jobs run in UTC — because a host's local zone changes unnoticed.

### Shared vocabulary

21. The correlation id is called `correlationId` everywhere: HTTP header `x-correlation-id`, envelope field, log field, trace attribute. It is accepted only from trusted hops (your gateway or BFF); otherwise it is created at that first ingress, then propagated on every outbound call and message and returned on every response, never regenerated after ingress — because one name joins logs, traces and messages, and a client-chosen id can spoof another request's trail.
22. Messages share one versioned envelope, `{ version, type, correlationId, idempotencyKey, payload }`, built by a single constructor per producer that takes `correlationId` from the current async context; consumers dispatch on `type`. Trace context (`traceparent`) travels in transport metadata and the tenant id, where there is one, in `payload`, never as envelope fields — because the envelope is a business contract, and per-hop or ambient data does not belong in it.
23. Lists are paginated by cursor (`first` + `after` in GraphQL, `limit` + `cursor` in REST, `page_size` + `page_token` in gRPC) over an ordering that ends in a unique tiebreaker, with a capped page size; offset pagination is allowed only for small, bounded admin views ([API transport](api-transport.md)) — because offsets slow down with depth and skip or repeat items while data changes.
24. Cache keys are `<resource>:<schema version>:<scope>:<id>`; ordered keys (indexes, unique constraints, object-storage prefixes, search routing) lead with the scope — because unversioned cache keys break deploys, and an ordered key without a leading scope scans other scopes.
25. Logs carry no secrets and no personal data beyond an opaque user id; the logger owns redaction ([observability](observability.md)). Metric labels come only from bounded sets: never ids, hashed or not, except a tenant id where [multi-tenancy](multi-tenancy.md) allows it — because a redaction rule nobody owns is not applied, and hashing does not bound cardinality.
26. A transport or a message processor calls its module's application service (the module's facade); outbound clients, caches and drivers live under `infrastructure/` — because one name per layer keeps boundary checks writable.
27. Multi-tenancy is opt-in: a repository that is multi-tenant says so in its map and follows [multi-tenancy](multi-tenancy.md); the other patterns write "the caller's scope" for whatever that pattern defines — because baking one tenancy model into every pattern makes them wrong for single-tenant systems.

### Enforcement

28. Where a tool can enforce a rule, the pattern names the tool and the rule, preferring Biome for linting and formatting, dependency-cruiser for import boundaries, the TypeScript compiler for types, and a test for behaviour — because a check cannot be skipped and prose can; repositories choose which checks to adopt.

## Example

How one failure travels through the conventions: a job tries to ship an order.

```ts
// The target state is already reached: a successful no-op (rule 10).
if (order.status === 'shipped') return { outcome: 'already-done' };

// Any other illegal transition is a typed, non-retryable error with a fixed code (rule 1).
if (order.status === 'cancelled') throw new OrderCannotShipCancelledError(order.id);
// The worker boundary dead-letters it without retrying, logs it with the correlationId
// taken from the envelope (rules 21, 22), and reports the dead letter once (rule 4).
```

## Signs of legacy

- `throw new Error(` or string throws; consumers outside the boundary checking `err.message ===` or class names.
- Idempotency keys built with `Date.now()`, `uuid()` or an attempt counter.
- `synchronize: true`, `autoIndex: true`, `createIndex(` or `CREATE TABLE` in application startup code.
- `skip`/`offset` pagination on public list endpoints; list endpoints without a maximum page size.
- Several names for the correlation id (`requestId`, `traceId`, `x-request-id`) used for the same thing.

## The patterns

| Area | Patterns |
|---|---|
| Foundations | [Errors](errors.md), [observability](observability.md), [configuration and secrets](configuration-and-secrets.md), [multi-tenancy](multi-tenancy.md) (optional), [authentication and authorization](authentication-and-authorization.md), [testing](testing.md) |
| APIs and frontends | [API transport](api-transport.md), [HTTP idempotency and rate limits](http-idempotency-and-rate-limits.md), [outbound calls](outbound-calls.md), [frontend architecture](frontend-architecture.md), [forms](forms.md), [hypermedia BFF](hypermedia-bff.md) |
| Data | [Repositories](repositories.md), [schema migrations](schema-migrations.md), [caching](caching.md), [read models and search](read-models-and-search.md), [data lifecycle](data-lifecycle.md) |
| Asynchronous work | [Async work](async-work.md), [outbox](outbox.md), [state machines and workflows](state-machines-and-workflows.md), [scheduled jobs](scheduled-jobs.md) |
| Delivery | [Delivery pipeline](delivery-pipeline.md) |
