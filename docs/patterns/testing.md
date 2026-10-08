---
type: pattern
---
# Testing

What each layer of tests proves, which dependencies are real, and how tests name the behaviour they prove.

## When it applies

- Applies: every repository with code, every language and test runner.
- Does not apply: throwaway spikes; their findings are written up, not shipped.

## Rules

### What each layer proves

1. Unit tests cover pure logic (domain rules, mapping, validation, state transitions) with no network, database or filesystem — because a unit test that touches I/O is a slow, flaky integration test with less realism.
2. Integration tests run each adapter (repository, queue consumer, search indexer, outbound client) against the real dependency in a container, at the major version production runs — because drivers, query planners and constraint behaviour are what break, and fakes reproduce none of them.
3. Contract tests guard every boundary between separately deployed repositories, run in both repositories' CI and before deploy — because two green test suites can still disagree about one payload.
4. End-to-end tests cover only the critical user journeys listed in the repository's architecture map, against a deployed environment — because broad end-to-end suites are slow and flaky enough that teams stop trusting them.
5. The integration database is built by the real migrations, never by ORM sync or hand-written setup SQL ([schema migrations](schema-migrations.md)) — because tests against a schema production never had prove nothing.

### Real dependencies, controlled inputs

6. Test repositories, transactions, unique constraints, locks, leases, claims and compare-and-set logic against the real database, never an in-memory fake or a different engine — because concurrency and constraint semantics are exactly what fakes get wrong.
7. Mock only at the process edge (third-party HTTP APIs, cloud SDKs, the clock); never mock your own repositories or modules in an integration test — because mocking your own code tests the mock.
8. Inject the clock, random values and id generators; tests set them — because code that reads the wall clock fails at midnight, at month end and on DST changes. [check: Biome: restricted-globals rule banning `Date` and `Math` in domain and application folders]
9. Each test creates its own data with unique ids and its own scope, runs in any order and in parallel, and leaves nothing others depend on — because shared fixtures make failures depend on test order. [check: test: the suite passes in shuffled order in CI]
10. Wait for asynchronous outcomes by polling a condition with a deadline, never with fixed sleeps; refresh search indexes explicitly before asserting — because sleeps are both slow and flaky, and search engines refresh on their own schedule.

### Behaviours the patterns require

11. Where a handler consumes at-least-once messages, test duplicate delivery and reordering ([async work](async-work.md)) — because both happen in production on every broker.
12. Where data is scoped, test that two scopes with the same ids cannot read or change each other's data ([multi-tenancy](multi-tenancy.md)) — because scope leaks are invisible in single-scope fixtures.
13. Where two actors can race (claims, transitions, counters), run them concurrently against the real database and assert exactly one wins — because sequential tests never exercise the race.
14. Every typed error a boundary translates has a test asserting its `code` and status ([errors](errors.md)) — because clients branch on those codes and an untested mapping drifts.

### Naming, assertions and hygiene

15. A test that proves an acceptance criterion starts its title with the criterion's ID, `it('CHECKOUT-PAY-1: charges the saved card', …)`, including table tests (`it.each(rows)('CHECKOUT-PAY-2: %s', …)`) — because the hub checks the link between criteria and tests in both directions.
16. Assert specific values; a snapshot of a large HTML or JSON document is never the only assertion, and snapshot updates are reviewed like code — because big snapshots get re-recorded without reading and then prove nothing.
17. Quarantine a flaky test with an owner and a fix-by date in its skip reason, and fix or delete it by then; CI retries never hide flakes silently — because an ignored flaky test teaches everyone to ignore red builds.
18. Treat coverage as a signal for review (uncovered changed lines), not a merge gate — because thresholds reward tests that execute code without asserting anything.

## Example

The test that is easy to get wrong: a race against the real database, with controlled time.

```ts
it('ORDERS-SHIP-4: only one of two concurrent shippers wins', async () => {
  const clock = fixedClock('2026-03-29T01:30:00Z'); // a DST change in Europe
  const order = await seedOrder(db, { scope: newScope(), status: 'packed' });
  const ship = () => shipOrder({ db, clock }, order.scope, order.id);

  const results = await Promise.allSettled([ship(), ship()]);

  expect(results.filter((r) => r.status === 'fulfilled' && r.value.outcome === 'shipped')).toHaveLength(1);
  expect(await db.orders.findById(order.scope, order.id)).toMatchObject({ status: 'shipped', shippedAt: clock.now() });
});
```

Against an in-memory fake both calls run one after the other, so the test passes even when the compare-and-set is missing.

## Signs of legacy

- `jest.mock('../repositories/` or mocked repositories in tests named integration.
- `sqlite::memory:` or in-memory database substitutes for a PostgreSQL or MongoDB production store.
- `setTimeout`, `sleep(` or `waitForTimeout(` in tests; `Date.now()` in domain code.
- `toMatchSnapshot()` as the only assertion on rendered pages or API responses.
- `.skip` or `xit` without an owner or a date; CI configured with blanket retries.
- Coverage thresholds that block merges; tests titled with no criterion ID for behaviour that has one.

## Notes

### Vitest and Jest

- Fake time with `vi.useFakeTimers()` / `vi.setSystemTime()` (Jest: `jest.useFakeTimers()` / `jest.setSystemTime()`), restored after each test.
- `expect.poll` (Vitest) waits for a condition with a timeout.
- Shuffle order in CI: Vitest `sequence.shuffle`, Jest `--randomize`.
- Separate unit and integration projects so the unit suite stays fast and runs without Docker.

### Testcontainers

- Start a container per test file or worker, not per test; isolate tests by data and scope, not by container.
- Pin image tags to the production major version; never `latest`.
- Read the mapped host port from the container; never assume a fixed port.
- Use the module's wait strategy (log line or health check) before connecting.

### Playwright

- Locate by role, label or test id (`getByRole`), never by CSS structure.
- Use web-first assertions that wait (`await expect(locator).toBeVisible()`), never `waitForTimeout`.
- Create test data through the API and reuse a signed-in `storageState`; drive the UI only for the journey under test.
- Record traces on the first retry and keep them as CI artifacts.

### Pact

- The consumer's tests generate the contract; the provider verifies every consumer's contract in its own CI with provider states.
- Publish contracts and results to a broker and gate each deploy on `can-i-deploy` for the target environment.
- Contract tests check shape and meaning at the boundary, not the provider's business rules.

### LocalStack

- Good for the API shape of S3, SQS, SNS, DynamoDB and EventBridge in integration tests.
- It does not prove IAM policies, quotas, throttling, timing or managed-service edge cases; a staging smoke test covers those.
- Pin its version; behaviour changes between releases.

### MSW

- Mock third-party HTTP at the network layer with `setupServer` in Node, `onUnhandledRequest: 'error'`.
- Override handlers per test with `server.use(...)` and reset after each test.
- Simulate the failure cases the outbound client must handle: timeouts, 429 with `Retry-After`, 5xx, malformed bodies ([outbound calls](outbound-calls.md)).
