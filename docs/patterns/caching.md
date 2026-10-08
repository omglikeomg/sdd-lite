---
type: pattern
---
# Caching

How a shared cache sits in front of a slower source without serving the wrong caller's data, overloading the source when entries expire, or keeping stale values after a write.

## When it applies

- Applies: shared caches in front of a repository or an outbound call (Redis or Valkey, an in-process cache, a CDN, a framework data cache).
- Does not apply: memoisation inside one request; read models and search indexes, which are projections with their own sync ([read models and search](read-models-and-search.md)); low-traffic data where a plain read-through with a TTL never overloads the source.

## Rules

### Placement and keys

1. The cache decorates the repository or client interface; application code never imports the cache client — because caching logic spread through services cannot be invalidated or reasoned about. [check: dependency-cruiser: only `infrastructure/` modules may import the cache client]
2. Entry keys follow [house conventions](house-conventions.md) rule 24, with the scope taken from the verified identity passed to the repository, never from a request field ([multi-tenancy](multi-tenancy.md)) — because a scope copied from the request lets a caller read another caller's entries. [check: test: two scopes with the same id get different keys]
3. The lease and generation keys of an entry wrap the entry key in a hash tag and add a suffix (entry `product:v3:s1:42`, lease `{product:v3:s1:42}:lock`, generation `{product:v3:s1:42}:gen`), so all three hash to the same slot — because a multi-key script fails with a cross-slot error in a cluster.
4. Responses that depend on who asks are cached per caller or not at all; shared caches hold only data every reader of that key may see — because a cache hit skips the authorization the source would have applied.

### Expiry and refresh

5. Every entry has two deadlines: `freshUntil` (after which a refresh starts) and a longer physical TTL that bounds how stale a served value can be; both carry random jitter — because one deadline makes every reader miss at once, and synchronised expiry recreates the stampede.
6. Between the two deadlines, a read returns the cached value at once and starts a refresh it does not await; the refresh catches and reports its own errors — because an awaited refresh puts the source's latency back on the request, and an uncaught rejection crashes Node. [check: test: a read near expiry resolves before a deliberately slow refresh does; no unhandled rejection]
7. Concurrent requests for one key in one process share one in-flight promise before any distributed lock is tried — because a hundred local requests otherwise make a hundred lock attempts.
8. Across processes, only the holder of a per-key lease loads from the source: the lease stores a random token with `SET NX PX`, and release or extension compare that token atomically — because a constant lock value lets an expired owner delete its successor's lease. [check: test: an expired owner's token cannot release or extend the new owner's lease]
9. A cold miss that loses the lease waits a short, jittered, bounded interval and rechecks the cache, then follows the stated overload policy (load anyway, or answer unavailable) — because letting every loser hit the source is the stampede itself.
10. Background refreshes per process are capped; above the cap the stale value is served and no refresh starts — because thousands of keys expiring together turn refresh-ahead into a flood.
11. Not-found results are cached with a shorter TTL than found ones — because repeated lookups of ids that do not exist pass straight through to the source.

### Writes and correctness

12. The refresher writes through one atomic script that stores the value only if it still holds the lease and the key's generation is the one it read before loading; writers bump the generation and delete the entry after their transaction commits — because a lease alone does not stop a refresh that loaded old data from overwriting a newer invalidation. [check: test: a write committed while a refresh is loading leaves the cache without the old value]
13. Invalidation that must not be lost is driven from the outbox or change log, not from the request after commit ([outbox](outbox.md)) — because a crash between commit and invalidation leaves the old value until its TTL ends.
14. The lease is an optimisation, never a correctness lock: anything that must happen once is guarded by the database (unique keys, version checks) — because cache locks vanish on failover and eviction.
15. Data that must not be stale (prices at checkout, permissions, balances) bypasses the cache or answers unavailable after the bounded wait — because a silently stale value there is a wrong decision, not a slow page.
16. When the cache is unavailable, reads fall back to the source within a short timeout while the source's own pool limits and rate limits stay in force — because a cache outage must not become an outage, nor a database overload.
17. Values are serialised with their schema version; an entry that fails to deserialise is deleted, reloaded and reported — because a poisoned entry otherwise fails every read until it expires.
18. Emit hit, miss, stale-served, refresh-contended and cache-unavailable metrics per resource ([observability](observability.md)) — because a cache nobody measures is either useless or the only thing keeping the database up, and you need to know which.

## Example

The fenced write with a generation check (ioredis). Reading the generation after loading from the source, or writing with a plain `SET`, reintroduces the race.

```ts
const FENCED_SET = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end          -- lease lost
if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[2] then return 0 end  -- written since we read
redis.call('SET', KEYS[3], ARGV[3], 'PX', ARGV[4])
return 1`;

const key = `product:v3:${scope.id}:${id}`; // house conventions rule 24
const [lockKey, genKey] = [`{${key}}:lock`, `{${key}}:gen`]; // same slot as `key`
const generation = (await redis.get(genKey)) ?? '0'; // BEFORE loading
const value = await source.findOne(scope, id);
const stored = await redis.eval(FENCED_SET, 3, lockKey, genKey, key,
  lease.token, generation, serialize(value), String(jitteredTtlMs()));
// Writers, after commit: INCR the generation key, then DEL the entry. Generation keys outlive entries.
```

## Signs of legacy

- `SET lock 1 NX`, `setnx` followed by `expire`, or `del(lockKey)` without a token check.
- `await this.refresh(` inside a read path; `.then(` with no `.catch` on fire-and-forget refreshes.
- Cache keys without a scope or a version; one fixed TTL such as `EX 3600` everywhere.
- `cache.set(` straight after a source read with no lease or generation check.
- `KEYS *` or pattern deletes used for invalidation.

## Notes

### Redis / Valkey (including managed and cluster mode)

- A cache wants an eviction policy such as `allkeys-lru`; queues ([async work](async-work.md)) and idempotency stores ([HTTP idempotency and rate limits](http-idempotency-and-rate-limits.md)) need `noeviction`, so a cache never shares a Redis with them.
- Cluster mode requires hash tags for every multi-key command or script; keep values small and avoid hot keys, which a single shard serves.
- Replication is asynchronous: a failover can drop recent writes and leases (rule 14).
- Set connect and command timeouts on the client; use `SCAN` instead of `KEYS`, and `UNLINK` for large deletes.

### In-process cache

- Bound it by entries or bytes (an LRU) and give it short TTLs: each instance holds its own copy and cannot see other instances' invalidations.
- Good for request coalescing (rule 7) and for small, hot, rarely changing data; not a substitute for a shared cache when consistency across instances matters.

### CDN and HTTP caching

- Personalised responses get `Cache-Control: private` or `no-store`; shared responses set `s-maxage` with `stale-while-revalidate` and `stale-if-error`.
- `Vary` lists every request header the response depends on; missing one serves the wrong variant.
- Purge by surrogate key or cache tag where the CDN supports it; path invalidations are slower and miss variants.
- Use `ETag` with `If-None-Match` for revalidation of large responses.

### Next.js data cache

- Defaults changed between major versions (version 15 stopped caching `fetch` by default): set caching explicitly per call (`cache`, `next: { revalidate, tags }`).
- Invalidate with `revalidateTag` or `revalidatePath` from the mutation path after the write commits.
- Reading cookies or headers makes a route dynamic; never place per-user data in a cache shared across users.
- Self-hosting several instances needs a shared cache handler; otherwise each instance keeps its own data cache.
