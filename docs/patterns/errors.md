---
type: pattern
---
# Errors

How errors are shaped, classified, wrapped and translated from the line that throws to the transport that answers, building on [house conventions](house-conventions.md) rules 1-7.

## When it applies

- Applies: all server-side code: HTTP and GraphQL handlers, queue consumers, scheduled jobs, CLIs that run in production, and adapters around drivers and SDKs.
- Does not apply: browser-side error display, which belongs to [frontend architecture](frontend-architecture.md) and [forms](forms.md).

## Rules

### Shape

1. Every intentional error extends one abstract application error whose constructor requires `retryable` and accepts `cause`; `code` is a readonly field fixed per class — because a missing constructor argument is a compile error, while a forgotten default is a silent retry storm or a lost job. [check: tsc: the base class is abstract, `code` is abstract, `retryable` is a required constructor option]
2. Throw only `Error` instances, never strings, plain objects or `undefined` — because only an `Error` carries a stack, and the boundary cannot classify anything else. [check: Biome: rule that disallows throwing non-Error values]
3. When you wrap an error, pass the original as `cause` (`new X(msg, { cause: err })`); never copy only `err.message` into a new error — because the stack and type of the real failure are what the on-call engineer needs. [check: test: a wrapped adapter error exposes the driver error as `cause`]
4. Context on an error is a small object with stable keys and no personal data or secrets, and it is never serialised to clients, which get only the bodies of house conventions rules 5-7 — because error context ends up in trackers and responses, and stacks in responses tell attackers what you run.

### Classification

5. `retryable: true` means "the same input may succeed later" (timeouts, connection resets, throttling, a lost race); business rule violations, validation and authorisation failures are `retryable: false` — because retrying a deterministic failure only delays the alert.
6. Adapters map driver and SDK errors to typed errors at the adapter, not in services: a unique violation becomes a conflict (after the check in house conventions rule 11), a connection reset becomes a retryable dependency error — because one mapping per driver is testable, and the same driver code scattered through services drifts.
7. Anything that reaches the boundary unclassified is wrapped in one concrete internal `UnhandledError` (code `unhandled-error`) that keeps the original as `cause` and follows house conventions rule 3; that code is never sent to clients, who see `internal-error` per house conventions rule 7 — because unknown values must still be logged with a stack and must not loop forever, and an internal class name in a response leaks nothing useful.

### Propagation

8. Catch an error only to handle it, to add context by wrapping it (rule 3), or to translate it at a boundary; never catch, log and rethrow — because each layer that logs the same failure multiplies log lines and hides which layer actually failed. [check: Biome: noUselessCatch, which flags catch blocks that only rethrow] [check: review: no catch block that logs and then rethrows] [check: test: one failing request produces exactly one error log line]
9. Never leave a catch block empty; a deliberate ignore states why in a comment and logs at debug at least — because a swallowed error turns a crash into silently wrong data. [check: Biome: rule that disallows empty block statements]
10. Application services and domain code never import transport error types (HTTP exceptions, status codes, GraphQL errors); each transport has one translator that maps `code` to its status — because a service that throws `404` cannot be reused from a worker or a CLI. [check: dependency-cruiser: domain and application modules may not import HTTP or GraphQL framework error modules]
11. A translator tests specific classes before the general base class, and branches on `code`, never on `message` or class name — because an `instanceof Base` check first makes every specific branch unreachable.
12. The boundary logs the failure once with the error object ([observability](observability.md)), reports it per house conventions rule 4, and answers with the body of house conventions rule 7 — because one log line per failure keeps the trail readable, and the correlation id is how support finds it.
13. Never install `uncaughtException` or `unhandledRejection` handlers that keep the process running; log, report, flush and exit non-zero — because the process state after an unhandled error is unknown, and the orchestrator restarting it is the safe recovery.

## Example

The base class and one adapter mapping: the two places where `retryable` defaults and lost causes usually creep in.

```ts
export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly retryable: boolean;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(message: string, opts: { retryable: boolean; cause?: unknown; context?: Record<string, unknown> }) {
    super(message, { cause: opts.cause });
    this.name = new.target.name;
    this.retryable = opts.retryable;
    this.context = opts.context;
  }

  toJSON() {
    return { code: this.code, message: this.message }; // never context, stack or cause
  }
}

export class OrderConflictError extends AppError {
  readonly code = 'order-already-exists';
  constructor(orderId: string, cause: unknown) {
    super('order already exists', { retryable: false, cause, context: { orderId } });
  }
}

// In the repository adapter (under infrastructure/), after the same-operation check of house conventions rule 11:
if (isUniqueViolation(err) && !(await sameOperation(order))) throw new OrderConflictError(order.id, err);
```

## Signs of legacy

- `throw new Error(`, `throw '`, `throw {` in application code.
- `new SomeError(err.message)` or `new SomeError(e.toString())` without `{ cause`.
- `catch (e) { logger.error(e); throw e; }` and empty `catch {}` blocks.
- `HttpException`, `NotFoundException`, `GraphQLError` or status numbers imported in services or domain modules.
- `err.message ===`, `err.message.includes(`, `e.constructor.name` in branching code.
- `process.on('uncaughtException'` without `process.exit`.

## Notes

### NestJS

- One global exception filter per transport, registered with `APP_FILTER`; it maps `AppError.code` to a status, keeps the status of `HttpException` instances from guards, pipes and body parsers, and normalises their body per house conventions rule 6.
- Services throw `AppError` subclasses, never `HttpException`; the filter owns status codes.
- Validation pipes produce the shape in house conventions rule 5; configure the pipe's `exceptionFactory` rather than reshaping in the filter.

### GraphQL (Apollo Server 5)

- Put `code` in `extensions.code`; translate in `formatError`, and set `includeStacktraceInErrorResponses: false` outside development.
- Failures returned as data and the HTTP status of GraphQL responses follow [API transport](api-transport.md) rules 16-17.

### BullMQ

- At the worker boundary, rethrow non-retryable errors as `UnrecoverableError` so the job fails without using its remaining attempts; let retryable ones use the job's `attempts` and `backoff`.
- Unclassified errors use the attempts limit, then land in the failed set, which is the dead-letter queue: alert on it ([async work](async-work.md)).

### SQS and Lambda

- Return `batchItemFailures` (with `ReportBatchItemFailures` enabled) so one failing message does not retry the whole batch.
- The redrive policy's `maxReceiveCount` is the attempt bound; a non-retryable message is sent to the dead-letter queue by the handler and then acknowledged, since SQS has no "do not retry" signal.

### Next.js (App Router)

- Server actions return `{ ok: false, code: "validation-failed", issues, values }` (house conventions rule 5) for validation failures instead of throwing; thrown errors reach `error.tsx` with the message replaced by a digest in production.
- Log the full error on the server with the digest, so the boundary's digest can be matched to the log line.
