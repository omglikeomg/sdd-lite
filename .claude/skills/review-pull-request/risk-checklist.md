# Risk checklist

The lens every review runs, whatever the stack. Each item is a question to ask of the diff; a finding still needs evidence from the code.

## Security and data

- **Secrets and personal data:** credentials, tokens, keys or personal data in code, fixtures, logs or error messages.
- **Untrusted input:** user input reaching queries, shell commands, file paths, HTML or redirects without validation or escaping.
- **Authorisation:** new or changed endpoints, resolvers and handlers check who is calling and whether they own the data, before reading or changing it.

## Performance and resources

- **Calls in loops:** database queries or remote calls inside a loop that one batched call could replace.
- **Unbounded work:** queries, lists or loops without a limit or pagination that grow with the data.
- **Cleanup:** connections, files, streams, timers, listeners and subscriptions closed or removed on every path, including errors and teardown.

## Concurrency and state

- **Races:** shared state changed by concurrent requests, jobs or handlers without a transaction, lock or atomic operation.
- **Retries:** a retried request or redelivered message must not repeat a side effect (a second charge, a duplicate email); look for an idempotency key or a guard.

## Failure

- **Swallowed errors:** errors caught and ignored, or logged without the context to act on them.
- **Crashes:** missing null checks, absent keys, out-of-range indexes and unhandled promise rejections on input the code does not control.
- **Timeouts:** every network call (HTTP, database, queue, third party) has one, and a failure there degrades instead of hanging.

## Compatibility

- **Interfaces others use:** public APIs, events, queues and shared types keep working for clients and services that deploy later or not at all (see `docs/contracts/`).
- **Schema changes:** migrations are safe during a rolling deploy, do not lock large tables, and do not drop data the previous version still reads.

## Operability

- **Logs:** state changes, failures and external calls log enough (entity IDs, correlation IDs) to debug them in production, and nothing secret.
- **Signals:** a new critical path has a way to tell whether it works (metrics, alerts or at least a countable log line).
