---
type: pattern
---
# API transport

How a network request becomes an application call and back, for every synchronous protocol: REST, GraphQL, gRPC, streaming, webhooks, BFF route handlers and server actions.

## When it applies

- Applies: REST controllers, GraphQL resolvers, gRPC services, SSE and WebSocket handlers, webhook receivers, Next.js route handlers and server actions.
- Does not apply: calls between modules in one process (call the application service directly); message consumers ([async work](async-work.md)). Server-rendered HTML routes follow this pattern plus [hypermedia BFF](hypermedia-bff.md).

## Rules

### Thin transport

1. A handler parses input, takes the verified caller, calls one application-service method ([house conventions](house-conventions.md) rule 26) and maps the result to the wire model; it holds no business rules and touches no storage — because logic in a transport is duplicated by the next protocol and skipped by workers. [check: dependency-cruiser: controllers, resolvers, route handlers and server actions may not import repositories, `infrastructure/` drivers or ORM clients]
2. Never return storage records; project every response through an explicit wire model (response DTO, GraphQL object type, protobuf message) — because storage fields leak and every schema change becomes an API break. [check: tsc: handler return types are wire-model types, not entity or document types]
3. Modules in one process call each other's application services, never each other's endpoints — because a self-call adds latency, auth and a failure mode for nothing.

### Input, identity and limits

4. Validate every input at the boundary against a schema that rejects unknown fields, answering per house conventions rule 5 — because silently accepted extra fields (`ownerId`, `role`) become mass-assignment holes. [check: test: a request with an unknown field answers 400 `validation-failed`]
5. Take identity and the caller's scope only from the verified credential ([authentication and authorization](authentication-and-authorization.md), [multi-tenancy](multi-tenancy.md)) and pass them explicitly to the application call — because a scope read from path, query or body lets one caller act as another. [check: test: a body carrying another scope's id is rejected or ignored]
6. Cap body size, page size and, for GraphQL, query depth and cost; rate limits follow [HTTP idempotency and rate limits](http-idempotency-and-rate-limits.md) — because unbounded input is a denial of service you ship yourself.

### Errors

7. Each transport has exactly one error translator: it maps typed errors ([errors](errors.md)) to the protocol checking the most specific class first, keeps framework 4xx per house conventions rule 6, and answers anything else exactly as house conventions rule 7 — because subclass-order bugs turn 409s into 500s and raw messages leak internals. [check: test: a guard rejection keeps its 4xx; an unknown throw yields only `internal-error` and the `correlationId`]
8. REST answers 404 for a missing resource; GraphQL returns `null` for a nullable field and a typed error for a non-null one — because each protocol's clients already handle that form.

### Contract

9. The contract (OpenAPI, GraphQL SDL, proto) is generated from code or code from it, committed, and regenerated in CI; a breaking diff fails the build unless versioned — because hand-written specs drift and breaking changes slip past review. [check: test: CI regenerates the contract and fails on an uncommitted diff or a breaking change]
10. Never remove, rename or narrow a field or endpoint in place: add the new one, deprecate the old with a removal date, check real usage, then remove — because clients you do not deploy break silently.

### Lists

11. Paginate by cursor per house conventions rule 23. GraphQL collections take `first` (capped, e.g. 100) and `after`, return `nodes`, optionally `edges { cursor node }`, and `pageInfo { endCursor hasNextPage }`; `totalCount` is resolved only when selected — because counting on every page doubles the cost of every list.
12. Cursors are opaque encodings of the last row's sort values plus the unique tiebreaker — because clients that parse cursors break when the ordering changes.
13. Filters are a typed `where` input of operator objects per scalar (reusable `IntFilter`, `StringFilter`, `DateTimeFilter` with `eq`, `in`, `gt`, `lt`), combinable with `AND`/`OR`; ordering is a typed `order` input over an enum of fields — because free-form filter strings cannot be validated or allowlisted.
14. Only allowlisted fields are filterable or orderable, each backed by an index; `contains` and full-text go to the search index ([read models and search](read-models-and-search.md)), never regex or `LIKE '%…%'` on the primary — because one unindexed filter is a full scan per request and client regex is a ReDoS vector.
15. Wire operators are translated to storage operators only in the repository ([repositories](repositories.md)); client input is never passed as a query object — because `{ "$where": … }` is operator injection.

### GraphQL

16. Mutations return expected business failures as data: a payload with `userErrors { code path message }` (house conventions rule 5) or a result union; top-level errors carry only unexpected failures, per house conventions rule 7 — because typed failures in the schema get handled, and top-level errors get ignored.
17. Never set an HTTP status from a field error; a response with partial data stays 200 — because one failing field otherwise discards every field that succeeded.
18. Resolve relations through DataLoaders created per request; a batch function returns exactly one slot per key, in key order, duplicates included — because shared loaders leak data between callers and misordered batches hand rows to the wrong parent. [check: test: keys `[b, missing, a, b]` yield `[B, null, A, B]` from one call]
19. Public APIs accept only persisted (allowlisted) operations or enforce depth and cost limits — because one nested query can fan out to millions of rows.

### Webhooks

20. A webhook receiver verifies the signature over the raw body bytes before parsing, compares in constant time, rejects timestamps outside a replay window (e.g. five minutes), and fails closed when the secret or signature is missing, in every environment — because re-serialised JSON changes the bytes, timing leaks the signature, and an optional check is an open endpoint. [check: test: unsigned, tampered and stale requests answer 401]
21. It deduplicates by the provider's event id (house conventions rule 12), records the event durably, then answers 2xx and processes it as [async work](async-work.md) — because work done inside the request times out at the provider and triggers redeliveries.

## Example

The batch function, where database order and missing rows break DataLoader's contract.

```ts
// Created once per request in the GraphQL context, never at module scope.
export const productLoader = (caller: Caller, products: ProductService) =>
  new DataLoader<string, Product | null>(async (ids) => {
    const rows = await products.findByIds(caller, [...new Set(ids)]);
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id) ?? null); // one slot per key, in key order
  });
```

For a non-null relation, put an `Error` in the missing key's slot instead of `null`.

## Signs of legacy

- Controllers or resolvers importing `mongoose`, `pg`, `PrismaClient`, `InjectModel` or `Repository<`.
- `.lean()`, `.toObject()` or raw rows returned to the client.
- `req.body.tenantId`, `@Body('userId')` or `args.ownerId` used to scope a query.
- `skip`/`offset` arguments on public lists; `first` or `limit` without a maximum.
- `new RegExp(` or `$regex`/`ILIKE` built from request input.
- `new DataLoader` at module scope; `@ResolveField` bodies calling a service per parent.
- GraphQL mutations throwing for validation failures; `http: { status` set in error formatting.
- Webhook handlers calling `JSON.parse` before verifying, or comparing signatures with `===`.

## Notes

### REST

- Version in the URI (`/v1/`); a breaking change opens a new version, and the old one sends `Deprecation` and `Sunset` headers until removal.
- 201 with `Location` for a synchronous create; 202 with `Location` of a status resource for accepted work; 409 for state conflicts; 412 for a failed `If-Match`; 429 with `Retry-After`.
- Lists return `{ items, next }`, where `next` is the full link or `null`; filter parameters are allowlisted and unknown ones answer 400.
- NestJS: a global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`; OpenAPI built by `SwaggerModule.createDocument` in a script and committed.

### GraphQL (Apollo Server 4, NestJS)

- Build loaders in the context function; `Scope.REQUEST` providers make every dependent provider request-scoped.
- Apollo Server 4 sets the HTTP status from `extensions.http.status`; never set it for field errors.
- Set `includeStacktraceInErrorResponses: false` outside development; Apollo includes stack traces unless `NODE_ENV` is `production` or `test`.
- NestJS guards and pipes throw `HttpException`s; the GraphQL exception filter maps their 4xx to `extensions.code` instead of `internal-error`.
- Automatic persisted queries are a cache, not an allowlist; use trusted documents for first-party public clients.
- Deprecate with `@deprecated(reason:)` and remove only after field-usage metrics show no callers.

### Webhooks

- Raw body: NestJS `rawBody: true` with `req.rawBody`; `await request.text()` in route handlers.
- `crypto.timingSafeEqual` throws on unequal lengths: compare lengths first.

### gRPC

- Run `buf breaking` in CI; never reuse a field number, and `reserved` removed fields and names.
- Map errors to `INVALID_ARGUMENT`, `NOT_FOUND`, `FAILED_PRECONDITION`, `UNAUTHENTICATED` vs `PERMISSION_DENIED`, and `UNAVAILABLE` only for retryable failures.
- Every call sets a deadline, and servers stop work when the propagated deadline passes.

### SSE and WebSockets

- Authenticate on connect with a cookie or a first message, never a token in the URL; authorize every subscription or topic; close the connection when the credential expires.
- Validate and size-limit every inbound message as you would a request.
- SSE sends an `id:` per event and resumes from `Last-Event-ID`; send heartbeat comments so proxies keep idle streams open.
- Fan out across instances through a broker (e.g. Redis pub/sub), never in-process memory alone.

### Next.js route handlers and server actions

- Server actions are public endpoints: [authentication and authorization](authentication-and-authorization.md) rule 18; their result shape is in [forms](forms.md).
- Route handlers wrap `request.json()` so malformed bodies answer 400, not 500.
