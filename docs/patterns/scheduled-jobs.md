---
type: pattern
---
# Scheduled jobs

How work triggered by the clock, recurring or one-time, gets enqueued exactly once per intended run.

## When it applies

- Applies: recurring jobs (reconciliations, sweeps, reports, retention purges) and one-time jobs at a given instant (reminders, trial expiry, scheduled publishing).
- Does not apply: the work itself, which runs in workers under [async work](async-work.md); deadlines inside a running workflow, which the orchestrator owns ([state machines and workflows](state-machines-and-workflows.md)).

## Rules

1. A scheduler only enqueues a job using the shared envelope; it never does the work — because work done inside the trigger has no retries, no backpressure and no dead-letter queue.
2. Never run in-process cron (timers, cron decorators, cron libraries) in services that run more than one instance or autoscale — because each instance fires its own copy, and runs are lost while instances restart. [check: dependency-cruiser: service code may not import cron scheduling libraries]
3. Every run is identified by its schedule id and its nominal run: the intended local date-time in the schedule's IANA zone, in basic ISO form with the zone id (`20261009T100000[Europe/Madrid]`), never the moment the trigger fired; the job's idempotency key is `schedule-run:<schedule-id>:<nominal run>`, which contains no `:` inside its parts ([house conventions](house-conventions.md) rule 8) — because triggers fire late, early or twice, and only the nominal run identifies the run.
4. Record each run in a table with a unique constraint on `(schedule_id, nominal_run)`, inserted in the same transaction as the job's outbox row ([outbox](outbox.md)); a conflict means the run is already enqueued — because the constraint is the distributed lock that deploy overlaps, replicas and regions cannot bypass. [check: test: two schedulers firing the same tick enqueue one job]
5. When the trigger cannot write to the database (a managed scheduler sending straight to a queue), the consumer's idempotency claim on the same key does the deduplication instead — because managed schedulers deliver at least once.
6. Time zones follow [house conventions](house-conventions.md) rule 20. A schedule in a zone with daylight saving runs a local time skipped in spring once, at the next valid instant, under its original nominal run; a local time repeated in autumn maps to one nominal run, so the unique constraint lets only the first instant through — because otherwise the run is lost once a year and doubled once a year. [check: test: a daily 02:30 schedule produces exactly one run on both transition days]
7. Every recurring schedule declares an overlap policy (skip, queue, or allow) for when the previous run has not finished; default to skip, counted and logged — because a slow run that overlaps the next one doubles the load and races on the same data.
8. Missed runs (scheduler down, deploy late, a one-time instant already past) are counted and alerted, not replayed automatically; a human decides from the runbook — because an automatic catch-up after an outage enqueues a burst of stale work at the worst moment.
9. Schedules live in version-controlled configuration or infrastructure code, each with an owner, a description and a runbook link, and change only through review and deploy — because a schedule edited in a console has no history and no owner at 3 a.m. [check: test: every schedule entry has owner, description, runbook and a time zone]
10. One-time schedules created by users at runtime live in a table (`due_at` in UTC, the user's zone for display, a status of pending, enqueued or cancelled); a recurring sweep enqueues due rows by claiming them, and cancelling is a state transition ([state machines and workflows](state-machines-and-workflows.md)) — because user data does not belong in deployed configuration, and a reminder for a cancelled booking must not fire.
11. Alert when a schedule has not produced a run within its expected interval plus a grace period — because a schedule that silently stopped looks exactly like a quiet night.
12. Jobs triggered by the clock are idempotent and convergent where possible (a sweep processes "everything due", not "the last hour") — because convergent jobs absorb a skipped or doubled run without manual repair.

## Example

The run record that turns any number of triggers into one job, in one transaction with the outbox row.

```ts
// nominalLocal: the run's intended local date-time in the schedule's zone, e.g. "20261009T100000"
async function enqueueRun(schedule: Schedule, nominalLocal: string) {
  const nominalRun = `${nominalLocal}[${schedule.timeZone}]`; // no ':' anywhere
  const key = `schedule-run:${schedule.id}:${nominalRun}`;
  await unitOfWork.run(async (tx) => {
    const inserted = await scheduleRuns.insertIfAbsent({ scheduleId: schedule.id, nominalRun }, { tx });
    if (!inserted) return; // another trigger, or the repeated autumn hour, already enqueued it
    await outbox.add(buildEnvelope({ type: schedule.jobType, idempotencyKey: key, payload: { nominalRun } }), { tx });
  });
}
```

Building the key from `new Date()` gives every duplicate trigger a different key, and building it from the UTC instant lets the repeated autumn hour run twice; `toISOString()` would also put `:` inside a key part.

## Signs of legacy

- `setInterval(`, `cron.schedule(`, `@Cron(` or `node-cron` in services deployed with more than one instance.
- Scheduled handlers that query and send emails or call partners directly instead of enqueueing.
- Idempotency keys for scheduled runs built from `Date.now()` or the trigger's invocation id.
- Cron expressions with no time zone; schedules created by hand in a cloud console.
- One-time reminders stored only as delayed queue messages, with no way to cancel them.

## Notes

### EventBridge Scheduler

- Supports an explicit time zone per schedule (with daylight saving handled), cron, rate and one-time `at()` expressions; prefer it to EventBridge rules for new schedules.
- Send to an SQS queue as the target and pass the scheduled time from the scheduler's context attribute (a UTC instant), convert it to the schedule's zone to build the nominal run, and let the consumer deduplicate on that key.
- Give every schedule a retry policy and a dead-letter queue; delivery is at least once.
- One-time schedules can delete themselves after completion; schedules created per user still need the table of rule 10 for cancellation and audit.
- A flexible time window spreads load; leave it off for jobs whose nominal time matters.

### BullMQ job schedulers

- `upsertJobScheduler` with a scheduler id is idempotent, so calling it at every boot is safe; pass `tz` with cron patterns.
- BullMQ produces one job per iteration from Redis, so several worker instances do not multiply runs; the Redis rules in [async work](async-work.md) still apply.
- Remove schedulers deleted from configuration explicitly at deploy; an upsert never removes the ones that disappeared.
- Delayed jobs suit short one-time delays; long-lived user reminders belong in the table so they can be cancelled and audited.

### Kubernetes CronJob

- Set `concurrencyPolicy: Forbid` (or `Replace`) to express the overlap policy; the default `Allow` lets runs pile up.
- Set `startingDeadlineSeconds`; without it, a controller outage can count missed runs and refuse to schedule further runs.
- Set `timeZone` explicitly; the controller can still create a job twice or skip one, so the job must be idempotent.
- Bound runs with `activeDeadlineSeconds` and `backoffLimit`, and keep the job history limits small.

### Lambda with EventBridge rules

- Rule schedules are evaluated in UTC only, with a six-field cron syntax; use EventBridge Scheduler when a local time zone matters.
- Invocation is at least once and asynchronous retries apply; build the nominal run from the event's `time` field (UTC, the only zone rules support) and enqueue rather than work in the function.
- Configure an on-failure destination so a failed trigger is visible.
