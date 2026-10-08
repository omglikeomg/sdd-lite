---
type: pattern
---
# HTTP idempotency and rate limits

How an HTTP or GraphQL API limits each caller and makes client-initiated mutations safe to retry with an `Idempotency-Key`.

## When it applies

- Applies: public and partner APIs, and internal APIs whose clients retry; rate limits on every route, idempotency keys on client-initiated `POST` and `PATCH` (and GraphQL mutations) that create or change state ([house conventions](house-conventions.md) rule 12).
- Does not apply: webhooks, which are deduplicated by the provider's event id ([API transport](api-transport.md)); `PUT` and `DELETE`, which are idempotent by definition; queue consumers ([async work](async-work.md)).

## Rules

### Order

1. Run the pipeline in this order: correlation id, authentication, limit resolution, rate limit, idempotency claim, handler, idempotency completion, error translation — because limits on unauthenticated identities can be dodged, and a rate-rejected client must not be able to allocate idempotency records. [check: test: a rate-rejected request never calls the idempotency store]

### Rate limits

2. Key limits by the authenticated principal within the caller's scope ([multi-tenancy](multi-tenancy.md)), never by an id from the body or a custom header; anonymous routes key by client IP taken from the proxy chain with a configured number of trusted hops — because client-supplied ids let callers spend someone else's quota, and the first `X-Forwarded-For` entry is whatever the client wrote.
3. The check, refill and decrement are one atomic operation in a shared store, using the store's clock — because get-then-set lets concurrent requests all pass, and process-local counters multiply the limit by the number of replicas. [check: test: 100 concurrent requests against capacity 10 admit at most 10]
4. Limits and request costs are resolved on the server from the verified identity and its plan; a client header may request a higher tier, never grant it — because a header that grants capacity is a header everyone sends.
5. Limit credential endpoints (login, password reset, one-time codes) per account and per client IP — because per-IP limits alone allow credential stuffing from many addresses, and per-account limits alone let one address lock out many accounts.
6. Edge throttling (gateway, WAF, CDN) is flood protection and stays in place, but it does not replace the per-principal limit — because edge rules see addresses and coarse windows, not plans and principals.
7. A rejection answers `429` with `Retry-After` and code `rate-limit-exceeded` — because clients without a retry hint retry at once and make the overload worse.
8. If the limiter store fails, a route fails open only when an edge limit still bounds it, and the failure is logged and alerted; credential, payment and expensive routes fail closed; the choice is written per route — because "fail open everywhere" silently removes protection during an incident.

### Idempotency keys

9. A covered mutation without an `Idempotency-Key` is rejected before any work with `400` and `{ "code": "idempotency-key-required", "message" }` (house conventions rule 6); the server never invents a fallback key — because a generated key is new on every retry and deduplicates nothing.
10. Store the client's key scoped as house conventions rule 9 requires (the operation id is the route template or GraphQL operation), together with a hash of the canonical request (method, route template, path parameters, body with sorted keys, no transport headers) — because the hash catches a key reused for a different request.
11. Claiming is one atomic operation with four outcomes: claimed (with a random owner token), in progress, completed (replay), conflict — because separate read and write steps let two identical requests both execute.
12. A key reused with a different hash answers `409` with code `idempotency-key-conflict`; a request whose twin is still running answers `409` with code `idempotency-key-in-progress` and `Retry-After` — because `425 Too Early` means TLS early data, and clients already treat `409` plus `Retry-After` as "try again".
13. The claim's lease outlives the request: either renew it while the handler runs, or set it longer than the server's request timeout; completion and release compare the owner token — because a lease that expires mid-request lets a retry run concurrently, and a stale owner must not overwrite the new owner's record.
14. The real guard against a duplicate side effect is in the write itself. Derive the operation key as `<operation>:<scope>:<sha256(principal, client key)>` (house conventions rule 9); for a create, allocate the entity id when the claim is made and store it in the claim record, so every retry reuses the same id; write the derived key under a unique constraint in the same transaction as the change, and pass it to providers for external side effects ([outbound calls](outbound-calls.md)). The HTTP claim only stops concurrent execution — because a crash between the side effect and storing the response is invisible to middleware, and a create that allocates a fresh id on each retry creates twice. [check: test: a crash after the business write, then a retry with the same key, produces one row with the same id]
15. Store the response (status, body, an allowlist of headers) before sending it, and replay it exactly; store `2xx` and deterministic `4xx` outcomes, and release the claim on `5xx` and `429` so a retry can run — because a response sent before it is stored is lost on crash, and a cached server failure makes a transient error permanent. [check: test: two concurrent identical requests cause one execution and identical responses]
16. Keep records for at least the clients' documented retry window (for example 24 hours), store only allowlisted response fields, and encrypt them at rest if they hold personal data — because the replay store is a second copy of your responses.
17. If the idempotency store is unavailable, covered mutations fail closed with `503` and code `idempotency-store-unavailable` — because executing without a claim is worse than a short outage.
18. Hash principal ids and client keys in store keys and logs; never use them as metric labels, hashed or not (house conventions rule 25) — because raw identifiers leak personal data, and hashing does not bound cardinality.

## Example

The atomic claim as one Redis script: a single key, so it also works on Redis Cluster.

```ts
// KEYS[1] = idem:<operation>:<scope>:<principal-hash>:<key-hash>
// ARGV[1] = request hash, ARGV[2] = owner token, ARGV[3] = lease in ms
export const BEGIN = `
local cur = redis.call('HMGET', KEYS[1], 'hash', 'state', 'response')
if not cur[1] then
  redis.call('HSET', KEYS[1], 'hash', ARGV[1], 'owner', ARGV[2], 'state', 'in-progress')
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  return {'claimed'}
end
if cur[1] ~= ARGV[1] then return {'conflict'} end
if cur[2] == 'completed' then return {'completed', cur[3]} end
return {'in-progress', tostring(redis.call('PTTL', KEYS[1]))}
`;
```

`HMGET` returns `false` for a missing key in Lua, so the first branch is the only one that claims; a separate `GET` then `SET` from Node would let two requests both reach it.

## Signs of legacy

- An in-memory limiter store in a service that runs more than one replica.
- Limiter keys built from `req.ip` on authenticated routes, or from `x-tenant-id`, `userId` in the body.
- `redis.get(` followed by `redis.set(` for idempotency, or a completion `set` that is not awaited.
- `res.json = ` or `res.send = ` overridden to capture responses.
- Fallback keys from `Date.now()` or `randomUUID()` when the header is missing.
- `425` returned for in-progress requests.

## Notes

### Redis

- Run the idempotency store with `maxmemory-policy noeviction` (or on its own instance); an evicting policy silently drops claims.
- Load scripts once (`defineCommand` in ioredis, or `SCRIPT LOAD` plus `EVALSHA`) and keep each script to one key per call, so it runs on Redis Cluster.
- Store the expiry on the key with `PEXPIRE` rather than comparing timestamps in the client.

### API Gateway and AWS WAF

- REST APIs support usage plans with per-key throttling and quotas; an API key identifies a client for metering, it is not authentication.
- HTTP APIs offer stage and route throttling only, which is a global ceiling, not a per-caller limit.
- WAF rate-based rules count requests per IP (or per forwarded IP or header) over minute-scale windows: use them for flood control in front of the application limiter.

### NestJS

- Nest runs middleware, then guards, then interceptors, then pipes; put authentication and the rate limit in guards, and idempotency in an interceptor.
- In the interceptor, await `complete` before the response is emitted (`mergeMap` over the handler result), and release the claim in `catchError` for `5xx`.
- `@nestjs/throttler` defaults to per-process memory storage; give it a Redis-backed storage before running more than one replica.

### CloudFront

- Forward `Authorization` and `Idempotency-Key` to the origin through an origin request policy, and never cache `POST` or `PATCH`.
- Read the client address from `CloudFront-Viewer-Address`, or count CloudFront as one trusted hop in `X-Forwarded-For`.
- Attach WAF rate-based rules to the distribution so floods stop at the edge.
