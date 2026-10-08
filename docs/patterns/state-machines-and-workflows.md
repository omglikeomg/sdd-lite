---
type: pattern
---
# State machines and workflows

How one entity's lifecycle is modelled, and how a process spanning several databases or services is coordinated with compensations.

## When it applies

- Applies: any entity with a status that changes through rules (orders, payments, subscriptions, approvals, tickets); any business process whose steps live in different databases or services.
- Does not apply: plain updates with no lifecycle; work inside one database, which uses one transaction ([house conventions](house-conventions.md) rule 18); event-sourced aggregates, which derive state from their log and need their own design.

## Rules

### One entity: the state machine

1. One state machine per entity type (or per aggregate with its tightly bound children); coordination across entities is a workflow, not a bigger machine — because a machine spanning entities grows without bound and cannot be tested alone.
2. The machine is pure domain code: a closed set of states, a transition table, and `transition(current, target, input)` returning the next state and its event or throwing — because framework or database code in it makes every rule depend on infrastructure. [check: dependency-cruiser: state machine modules may import only the domain error types]
3. `transition()` is the only writer of the status; repositories expose no free-form `setStatus` — because a status assigned in a controller skips every rule. [check: test: no module outside the machine and its repository writes the status column]
4. Status is a closed enum in code and in storage (a database enum or check constraint), and each state carries its own typed data — because free-form strings drift and a state missing its data is unrepresentable only when the types forbid it. [check: tsc: the state type is a discriminated union]
5. Persist a transition with a compare-and-set on the state it started from, or on a version column (`UPDATE ... WHERE id = $1 AND status = $from`), and treat zero affected rows as a concurrent change to re-read — because two requests that both read the old state both pass the check in memory. [check: test: two concurrent transitions from one state, exactly one wins]
6. Asking for the state the entity is already in is a successful no-op; only other illegal transitions throw a typed, non-retryable error answered as 409 or dead-lettered ([house conventions](house-conventions.md) rules 1 and 10) — because redelivered commands are normal and must not fill dead-letter queues.
7. Cycles are allowed; terminal states are leaves with no outgoing transitions ([house conventions](house-conventions.md) rule 17) — because lifecycles pause and resume, but a closed record must never change. [check: test: every terminal state has no entry in the transition table]
8. Write the state change and its event's outbox row in the same transaction ([outbox](outbox.md)) — because an event emitted separately is lost on a crash or describes a change that rolled back.
9. Test every legal pair in the table and every illegal pair, generated from the table itself ([testing](testing.md)) — because a hand-picked list of cases misses the edge someone added last.

### Several databases: the workflow

10. Use a workflow (saga) only when the steps commit to different databases or services; within one database use a transaction — because a saga trades atomicity for many new failure modes.
11. Choose choreography or an orchestrator by [house conventions](house-conventions.md) rule 18; the orchestrator owns the workflow's state and is the only component that decides the next step — because decisions spread across subscribers cannot be read, tested or recovered in one place.
12. The workflow instance is itself a state machine under the rules above, persisted, with its state written only by the orchestrator — because state with several writers corrupts, and a workflow whose state lives only in an event chain cannot answer "where is it now?".
13. Each step is an idempotent consumer ([async work](async-work.md)) whose key is `<workflow>:<instance-id>:<step>`, never including an attempt number ([house conventions](house-conventions.md) rule 8) — because a key that changes on retry re-runs a step that already charged the customer.
14. Order steps so that reversible ones come first, then the point of no return, then steps that can only be retried forward; steps after the point of no return retry until they succeed or a human intervenes — because a step that cannot be undone (an email, a shipment) has no meaningful compensation.
15. Every step before the point of no return has a compensation; compensations are idempotent, retry persistently with backoff, and run in reverse order of the completed steps — because a compensation that gives up after one error leaves money or stock half-moved.
16. Each step has its own timeout and retry budget; a timeout means the outcome is unknown ([outbound calls](outbound-calls.md)), so before compensating, the orchestrator confirms the step's outcome or cancels it — because compensating a step that is still running and then succeeds leaves both effects applied.
17. Mark resources a workflow holds with pending states (`reserved`, `payment-pending`) that other processes respect, and make a late success arriving after compensation trigger its own compensation — because sagas have no isolation, and readers otherwise act on half-finished work.
18. When compensation keeps failing past its budget, move the instance to a `stuck` state, report it once, and list stuck instances for operators with their last transition and error; a synchronous retry by hand is an operator action only — because silent inconsistency is found by customers first.
19. Every transition logs instance id, workflow name, from-state, to-state, step, attempt and `correlationId` ([observability](observability.md)) — because a workflow that cannot be traced step by step cannot be repaired.

## Example

Rules 5 and 6 together: the transition that is easy to get wrong, persisted with a compare-and-set and the event in the same transaction.

```ts
async function ship(orderId: OrderId, input: ShipInput, key: string) {
  return unitOfWork.run(async (tx) => {
    const order = await orders.get(orderId, { tx });
    if (order.state.status === 'shipped') return { outcome: 'already-done' as const };

    const next = orderMachine.transition(order.state, 'shipped', input); // throws if illegal
    const updated = await orders.updateState(orderId, next.state, { tx, expectedStatus: order.state.status });
    if (!updated) throw new ConcurrentTransitionError(orderId); // retryable by its class

    await outbox.add(buildEnvelope(next.event, key), { tx });
    return { outcome: 'shipped' as const };
  });
}
```

Without `expectedStatus` a concurrent cancel and ship both succeed; without the early return a redelivered ship command becomes an illegal-transition failure.

## Signs of legacy

- `status: string` columns; `if (x.status === '` chains in controllers or services.
- `.status = '` assignments or `updateStatus(` calls outside the state machine and its repository.
- `UPDATE ... SET status = $1 WHERE id = $2` with no condition on the previous status or version.
- `eventBus.emit(` next to a repository write; events published from "after commit" hooks.
- Chains of services reacting to each other's `*-failed` events with no workflow state anywhere.
- Idempotency keys containing `attempt`, `retryCount` or `Date.now()`.

## Notes

### Hand-rolled with a table

- A `Record<Status, readonly Status[]>` of legal targets plus a discriminated union of states is enough for most entities; generate the tests from the table.
- Keep the table in one file next to the machine; a new state is a change to the union, the table and the events together.
- For workflows, persist one row per instance (state, current step, attempts, deadlines) and drive it from a queue consumer; a scheduled sweep finds instances past their deadline ([scheduled jobs](scheduled-jobs.md)).

### XState (optional)

- Useful when guards, nested or parallel states make the table hard to read; keep machine definitions free of side effects and run effects in the application layer.
- Persist the machine's snapshot or the plain status, never an actor that lives only in memory; the compare-and-set and outbox rules still apply.

### Temporal

- Workflow code must be deterministic: no direct I/O, no clocks or randomness outside the SDK's own APIs; change running workflow code through the SDK's versioning (patching) mechanism.
- Activities run at least once: make them idempotent with the step key, set a start-to-close timeout on every activity, and heartbeat long ones with a heartbeat timeout.
- Use a meaning-based workflow id with an id reuse policy as the deduplication of starts.
- Pass references, not large payloads; history and payload sizes are limited.
- Compensations are code in the workflow (run in reverse in a `finally` or catch block) with their own retry policy.

### AWS Step Functions

- Standard workflows run each execution once and can last up to a year; Express workflows are at-least-once (asynchronous) and short, so use them only with idempotent steps.
- Declare `Retry` (with `BackoffRate`, `MaxAttempts`, jitter) and `Catch` per task state; route `Catch` to compensation states in reverse order.
- Wait for external work with a task token (`.waitForTaskToken`) and set `HeartbeatSeconds` and `TimeoutSeconds` on that state.
- A Standard execution name is unique for a period after it closes; use the meaning-based key as the name to deduplicate starts.
- State payloads have a size limit; pass references to stored data.
