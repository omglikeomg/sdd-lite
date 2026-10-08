---
type: pattern
---
# Outbound calls

How code calls anything it does not own (other services, third-party APIs, databases, caches, cloud SDKs): timeouts, deadlines, retries, circuit breakers, pools and the typed client that wraps them.

## When it applies

- Applies: every network call made from a request handler, worker, function or scheduled job.
- Does not apply: retries of whole messages or jobs, which the broker owns ([async work](async-work.md)); cache read-through policy ([caching](caching.md)).

## Rules

### One client per dependency

1. Each dependency has one client module under `infrastructure/` (house conventions rule 26) that owns its base address, credentials, timeouts, retries, breaker and pool, sends `x-correlation-id` from the async context on every call, and maps every response or failure to a typed result or error ([errors](errors.md)); application services never call `fetch`, an HTTP library or a vendor SDK directly — because policies scattered across call sites are inconsistent and untestable, and a call without the correlation id ends the trail. [check: dependency-cruiser: only modules under `infrastructure/` may import HTTP libraries and vendor SDKs]
2. Create the client and its connection pool once per process and reuse it; never per request — because a new client per call repeats DNS and TLS handshakes and exhausts sockets under load.
3. Validate responses against a schema at the client; a response missing required fields becomes a typed, non-retryable `<dependency>-contract-violation` error, and unknown fields are ignored — because an unvalidated payload fails three layers later with a `TypeError` nobody can trace.

### Timeouts and deadlines

4. Every call has an explicit total timeout chosen from the dependency's measured latency, never the library default — because many defaults are minutes or infinite, and one hung dependency then holds every request open. [check: test: a stub server that never answers makes the client fail within its configured timeout]
5. Propagate the caller's deadline: the timeout for each call is the smaller of its own timeout and the time left before the server request timeout ([house conventions](house-conventions.md) rule 19); in workers and scheduled jobs the budget is the job's lease or visibility timeout; a call with no time left is not started — because work finished after the caller gave up is pure load, and a job that outlives its lease is redelivered while still running.
6. Pass the caller's cancellation signal to every outbound call — because a client that disconnects should stop the work it started.

### Retries

7. Retry only requests that are safe to repeat: idempotent methods, or requests carrying an idempotency key the provider honours; that key is the operation's derived key (house conventions rule 8), and for creates the key of house conventions rule 9 ([HTTP idempotency and rate limits](http-idempotency-and-rate-limits.md)) — because retrying a non-idempotent request after a timeout can charge, send or create twice.
8. Retry only transient failures (connection errors, timeouts on safe requests, `429`, `502`, `503`, `504`, and their SDK equivalents), honour `Retry-After`, and use exponential backoff with full jitter, at most 3 attempts on a request path, all within the deadline — because synchronised retries from many callers hit a recovering dependency all at once.
9. Retry at one layer only: the SDK, the client module, or the queue, never more than one of them. In workers the queue is the retry layer, and clients make one attempt (for example AWS SDK `maxAttempts: 1`) — because stacked retries multiply (3 × 3 × 3 is 27 calls for one request).
10. Cap retries with a budget per dependency per process (for example retries at most 10 percent of calls); past the budget, fail fast — because retries during an outage multiply load exactly when the dependency can least take it.
11. When the outcome of a non-idempotent call is unknown (a timeout after the request was sent, a connection lost during a database commit), record it as unknown and reconcile by reading the provider's or database's state, never by repeating the call — because "probably failed" is how double charges and duplicate rows happen. [check: test: a timeout after sending leads to a status read, not a second call]

### Circuit breakers

12. Each dependency has a breaker per process that counts only availability failures: connection refused or reset, DNS or TLS failures, timeouts, `502`, `503`, `504`, and `429`, the one `4xx` that may count, where the client's policy says so — because counting validation errors or not-found answers trips the breaker on a healthy dependency.
13. Exhaustion of the caller's own pool is reported as saturation and does not count against the dependency — because local overload is not evidence that the dependency is down.
14. Outcomes that say nothing about availability (every `4xx` other than a `429` counted by rule 12, a bug in the callback, caller cancellation) are neutral: they neither count as failures nor close a half-open breaker — because a probe that never reached the dependency proves nothing.
15. After the open window, admit exactly one probe and give it its own deadline; a probe that overruns counts as a failure and reopens the breaker — because a hung probe otherwise keeps the breaker half-open, rejecting every caller, forever. [check: test: a probe that never completes reopens the breaker after the probe deadline]
16. Every permit carries the breaker's generation, and completions from an older generation are ignored — because a slow call from before the breaker opened must not close it.
17. An open breaker fails fast with a retryable typed error; a fallback is used only when the domain defines one (stale cached data, a degraded response), never a fabricated success — because silent fake success corrupts data downstream.

### Pools and bulkheads

18. Every pool (database, cache, HTTP agent) has a maximum size and an acquire timeout set through the driver's native option; never race the acquire against a timer — because a raced acquire that resolves late hands out a connection nobody releases, and the pool leaks until it is empty.
19. Size pools so that instances times pool maximum stays below what the dependency accepts, with headroom for deploys that double the instance count — because a rolling deploy otherwise exhausts the database's connection limit.
20. Isolate dependencies and workloads with separate pools or concurrency limits (bulkheads), with bulk jobs on their own pool — because one slow dependency or batch job otherwise takes every socket and stalls unrelated requests.
21. Release connections in `finally`; a failed release after a successful operation destroys the connection and is logged, without failing the call; an operation error is never replaced by a release error — because surfacing a release error makes callers retry work that already committed.
22. Emit per-dependency metrics: latency histogram, outcomes by status class, retries, breaker state, pool in-use versus max and waiters ([observability](observability.md)) — because saturation and retry storms are invisible without them.

## Example

Breaker permit acquisition with a probe deadline and neutral outcomes: the two places the naive breaker gets stuck.

```ts
type Permit = { gen: number; probe: boolean };

tryAcquire(now = Date.now()): Permit | null {
  if (this.state === 'closed') return { gen: this.gen, probe: false };
  if (this.state === 'half-open') {
    if (now < this.probeDeadline) return null; // the single probe is still running
    this.open(now);                            // the probe overran: treat it as a failure
    return null;
  }
  if (now < this.retryAt) return null;          // still open
  this.state = 'half-open';
  this.gen += 1;                                // late results from before are now stale
  this.probeDeadline = now + this.probeTimeoutMs;
  return { gen: this.gen, probe: true };
}

onSuccess(p: Permit) { if (p.gen !== this.gen) return; if (p.probe) this.close(); this.failures = 0; }
onFailure(p: Permit, now = Date.now()) {
  if (p.gen !== this.gen) return;
  if (p.probe || ++this.failures >= this.threshold) this.open(now); // open() and close() bump gen
}
onNeutral(p: Permit, now = Date.now()) {
  if (p.gen === this.gen && p.probe) { this.open(now); this.retryAt = now; } // let the next caller probe
}
```

The probe's own call timeout should be shorter than `probeTimeoutMs`, so the deadline only catches calls that ignore their timeout.

## Signs of legacy

- `fetch(` or `axios.` calls in services or handlers, or HTTP clients created inside request handlers.
- No `timeout`, `signal` or `AbortSignal.timeout` on outbound calls; axios instances without `timeout`.
- `Promise.race([pool.connect(), sleep(…)])` or a hand-made timer around pool acquisition.
- Retry loops with a fixed `sleep`, no jitter, or around `POST` calls without an idempotency key.
- An SDK configured with retries called from a job that the queue also retries.
- Pools created with no maximum, or one pool shared by bulk jobs and interactive requests.

## Notes

### fetch and undici

- Node's `fetch` has no total timeout of its own; pass `signal: AbortSignal.any([callerSignal, AbortSignal.timeout(ms)])`.
- Share one undici `Agent` (as the `dispatcher`) per dependency to set `connections`, `keepAliveTimeout` and connect timeouts.
- Always consume or cancel the response body, even on errors; an unread body keeps the socket from returning to the pool.
- `fetch` does not retry; retries belong in the client module.

### axios

- The default `timeout` is `0` (none): set it on every instance with `axios.create`.
- Pass `signal` for cancellation; one instance per dependency holds its base URL, headers and interceptors.
- If you add `axios-retry`, keep its condition to network errors and idempotent methods, and add jitter.

### AWS SDK v3

- Clients retry by default (standard mode, 3 attempts); set `maxAttempts` explicitly, and choose `retryMode: 'adaptive'` for client-side throttling against busy APIs.
- Set `requestHandler` with `connectionTimeout` and `requestTimeout`; by default a hung request has no request timeout.
- Create clients outside the Lambda handler so invocations reuse connections; pass `abortSignal` in `client.send(command, { abortSignal })`.

### gRPC

- Set a `deadline` on every call and derive it from the incoming call's deadline (in `@grpc/grpc-js`, pass the incoming call as `parent` to propagate it); on the wire it travels as remaining time.
- Configure retries in the service config (`retryPolicy` with `retryableStatusCodes` such as `UNAVAILABLE`), not in application loops.
- Treat `DEADLINE_EXCEEDED` on a non-idempotent call as an unknown outcome (rule 11).

### Database and cache pools

- PostgreSQL (`pg`): set `max`, `connectionTimeoutMillis`, `idleTimeoutMillis` and a `statement_timeout`; call `client.release(err)` with the error after a failure so the connection is destroyed, not reused.
- MongoDB: set `maxPoolSize`, `waitQueueTimeoutMS`, `serverSelectionTimeoutMS` and `maxTimeMS` per operation; the driver already retries one write and read (`retryWrites`, `retryReads`), so do not stack another retry on top.
- Redis (ioredis): set `commandTimeout` and `enableOfflineQueue: false` on request-path connections so they fail fast; BullMQ worker connections need `maxRetriesPerRequest: null` and are the exception.
- Lambda: each concurrent execution holds its own pool; keep the pool at one or two connections and put RDS Proxy (or the database's own pooler) in front of PostgreSQL.
