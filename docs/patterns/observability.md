---
type: pattern
---
# Observability

Logs, traces and metrics for every server-side runtime: what is emitted, how it is correlated, who redacts it and how long it is kept, building on [house conventions](house-conventions.md) rules 21, 22 and 25.

## When it applies

- Applies: every backend process (HTTP and GraphQL servers, workers, scheduled jobs, functions) and the server side of web frameworks.
- Does not apply: browser telemetry and product analytics, which are separate pipelines with their own consent rules.

## Rules

### Logs

1. Each runtime uses one structured logger that writes one JSON object per line to stdout; application code never calls `console.*` — because mixed formats cannot be queried, and a second logger skips redaction. [check: Biome: noConsole]
2. The process never ships logs over the network itself; the platform collects stdout (container log driver, function runtime, node agent) — because an in-process network write puts the log backend on the request path, and its outage becomes yours.
3. Every line carries `level`, `time`, `msg`, `service`, `env`, `version` (the build id), `context` (the module), `correlationId`, and `traceId`/`spanId` when tracing is on — because these are the fields every incident query filters by.
4. Open an async context at every ingress (HTTP request, message, job, scheduled tick) before the first `await`, carrying the inbound `correlationId` only when it comes from a trusted hop and a new one otherwise (house conventions rule 21); the logger reads it at write time and nobody passes it as an argument — because threading ids by hand is forgotten in exactly the code path that fails. [check: test: a line logged inside a handler carries the request's `correlationId`]
5. Read `correlationId` from the async context in the envelope constructor (house conventions rule 22) and in the outbound clients, which send it as `x-correlation-id` ([outbound calls](outbound-calls.md)) — because a hop that does not forward the id ends the trail. [check: test: a message published inside a request carries that request's `correlationId`]
6. Log errors by passing the error object under `err`, never `err.message`; the serializer emits type, message, stack, `code` and the `cause` chain — because the message alone loses the stack and the root cause.
7. Levels have fixed meanings: `error` for unexpected failures, `warn` for expected rejections worth seeing (authentication and authorisation failures, rate limits), `info` for state changes, `debug` off in production — because inconsistent levels make alerts on `error` useless.
8. A failure is logged once, at the boundary that handles it ([errors](errors.md) rule 8) — because duplicate lines inflate counts and cost.

### Redaction and retention

9. The logger owns redaction: objects are logged only through serializers that emit an allowlist of keys (for a request: method, route template, status, duration), and a denylist of paths (`authorization`, `cookie`, `password`, `token`, `secret`) censors values as a backstop — because a denylist alone misses the next new field, and an allowlist alone fails open when someone logs a raw object. [check: test: logging a fixture that contains a known secret and an email emits neither]
10. Never log request or response bodies, full headers, query strings or whole domain objects; log ids — because bodies carry personal data and credentials (house conventions rule 25).
11. Retention is set per environment on every log store, as short as debugging and security investigation need (for example 7 days dev, 14 staging, 30 production); nothing in application logs is kept longer — because logs with personal data must follow data minimisation, and "keep everything for years" is a liability, not compliance.
12. Records with a legal retention duty (audit trails, financial events) are written as data to their own store with their own retention ([data lifecycle](data-lifecycle.md)), never kept by extending log retention — because a legal hold on all logs keeps every incidental personal datum for the full term.

### Traces

13. Use OpenTelemetry, initialised before any instrumented library is loaded, with automatic instrumentation for HTTP, database, cache and queue clients — because instrumentation patches modules when they load, and late initialisation silently traces nothing.
14. Propagate W3C trace context (`traceparent`) on outbound HTTP and in message transport metadata as house conventions rule 22 places it, and record `correlationId` as a span attribute — because a hop without trace context starts a new, disconnected trace.
15. Span names and attributes use templates and bounded values (`GET /orders/:id`, the queue name), never raw URLs, ids in names, or personal data — because span names are aggregation keys.
16. Use parent-based sampling so a trace is kept or dropped as a whole, and export over OTLP to a collector or agent, not straight to a vendor — because partial traces mislead, and a collector lets you change backend or sampling without a deploy.

### Metrics and health

17. Metric labels come from bounded sets (route template, status class, operation, dependency, queue); never ids of any kind, hashed or not, raw URLs or error messages, except a tenant id where [multi-tenancy](multi-tenancy.md) allows it (house conventions rule 25) — because each distinct label value is a new time series, and unbounded labels break the metrics backend and the bill.
18. Every ingress emits rate, errors and a duration histogram; every pool and queue emits in-use versus max, waiters, depth and age of the oldest item — because saturation shows up in waiters and age before it shows up in errors.
19. Alert on symptoms (error rate, latency against the repository's budget, dead-letter depth above zero, oldest-message age), not on CPU or memory alone — because users feel symptoms, and resource alerts page for healthy load.
20. Liveness checks only that the process can serve; readiness may check critical dependencies — because a liveness probe that checks the database restarts every instance during a database blip.

## Example

The correlation seam with Pino: the context is opened at the ingress and read by the logger on every line.

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pino from 'pino';

type Ctx = { correlationId: string };
export const context = new AsyncLocalStorage<Ctx>();

export const logger = pino({
  base: { service: process.env.SERVICE_NAME, version: process.env.BUILD_ID },
  mixin: () => ({ correlationId: context.getStore()?.correlationId }),
  redact: { paths: ['*.authorization', '*.cookie', '*.password', '*.token'], censor: '[redacted]' },
});

// Ingress from our own queue (a trusted hop): wrap the whole unit of work, before any await.
export function onMessage(msg: { correlationId?: string }, handle: () => Promise<void>) {
  return context.run({ correlationId: msg.correlationId ?? randomUUID() }, handle);
}
```

A context opened after the first `await`, or work started in a detached promise outside `run`, loses the id without any error.

## Signs of legacy

- `console.log(`, `console.error(` in application code; more than one logger package in a lockfile.
- Logger transports that send to a log backend over HTTP from the application process.
- `logger.error(err.message)`, `logger.error(\`…${err}\`)`.
- `correlationId` or `requestId` passed as a function parameter through service layers.
- Metric labels built from `userId`, `tenantId`, `req.url` or `err.message`.
- Log groups or indices with no retention set ("never expire").

## Notes

### Pino

- Use `redact.paths` for the denylist backstop and custom `serializers` for the allowlist; `mixin` adds the context fields to each line.
- Keep `pino-pretty` for local development only; production writes raw JSON.
- Child loggers (`logger.child({ context: 'OrdersService' })`) give each module its `context` field once.

### NestJS

- Use `nestjs-pino` (`LoggerModule.forRoot`) and create the app with `bufferLogs: true`, then `app.useLogger(app.get(Logger))`, so bootstrap logs go through the same logger.
- Its HTTP auto-logging replaces hand-written request logging; set its serializers to the allowlist in rule 9.
- Inject per-class loggers with `PinoLogger` and `setContext`, or `@InjectPinoLogger(ClassName.name)`.

### Next.js (server)

- Start OpenTelemetry in `instrumentation.ts` (`register()`), which runs before the app code loads.
- Import the logger only from server modules, guarded with `import 'server-only'`, so it never reaches a client bundle.
- Route handlers and server actions open the correlation context themselves; middleware runs as a separate step (often on the edge runtime) and cannot share `AsyncLocalStorage` with them; pass the id forward in a request header.

### AWS Lambda

- Stdout goes to CloudWatch Logs; create the log group in infrastructure code with a retention period, since the default never expires.
- Powertools for AWS Lambda (TypeScript) provides a structured Logger, Tracer and Metrics (embedded metric format, no network call).
- For OpenTelemetry, use the ADOT layer or a collector extension; flush before the invocation ends.

### ECS and containers

- Use the `awslogs` driver or FireLens to collect stdout; set retention on the target log group.
- Run an OpenTelemetry collector as a sidecar (or daemon) and point the SDK at `localhost` over OTLP.
- Configure the SDK through `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, and preload it with `node --import` (ESM) or `--require` (CommonJS).
