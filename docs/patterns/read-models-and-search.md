---
type: pattern
---
# Read models and search

Projections of data another system owns, kept in sync one way, and search indexes derived from them.

## When it applies

- Applies: a query-shaped copy of data owned by another service or a CMS; a search index (Elasticsearch, OpenSearch, PostgreSQL full-text, a vector store) fed from a primary database; backfills and rebuilds of either.
- Does not apply: data this service owns and writes ([repositories](repositories.md)); a rarely read entry fetched on demand behind a cache ([caching](caching.md)); display-only content a page fetches server-side.

## Rules

### Projections

1. Build a projection only for a query you can name; otherwise fetch from the owner behind a cache — because every projection is a sync pipeline that has to be run, monitored and rebuilt.
2. Sync one way: the owner is the system of record and nothing writes back to it from the projection — because two-way sync creates loops and leaves no one owning the truth.
3. Keep every projection and index rebuildable from its source with a command that is exercised, not just written — because a lost or corrupted copy you cannot rebuild has quietly become a system of record.
4. Make the producer durable: an outbox row ([outbox](outbox.md), [house conventions](house-conventions.md) rule 15) or a webhook ingress that enqueues before it acknowledges; never a best-effort HTTP call from a hook — because an event lost between commit and send is a silent, permanent divergence.
5. A source webhook receiver follows the webhook rules of [API transport](api-transport.md) and does nothing but enqueue a sync job; every configured source has a verifier, and a source without one is rejected — because sync work done in the request times out at the provider and triggers retries, and a source that skips verification is an open write path into the projection. [check: test: an unsigned or tampered request is rejected for every configured source]
6. Treat an event as a notification: trust only the entity id, type and action, and re-read the current state from the owner before writing — because payloads arrive stale, duplicated, reordered or forged, and re-reading makes them all converge.
7. When the re-read returns not found (deleted, unpublished, out of the caller's scope), delete the projection row and finish successfully — because treating not-found as a failure dead-letters every delete.
8. Write with an upsert keyed on the caller's scope plus the source id, backed by a unique constraint and guarded by the source version ([house conventions](house-conventions.md) rule 16) — because a create/update split races on duplicates, and two workers re-reading at different moments let the slower one overwrite newer data. [check: test: applying version 2 then version 1 leaves version 2]
9. Resolve the scope at ingress from the authenticated source configuration, never from the webhook body; it then travels in the queued payload ([house conventions](house-conventions.md) rule 22) and is a required argument of every read and write ([multi-tenancy](multi-tenancy.md)) — because a body-chosen scope lets one source write into another's data.
10. Only the adapter module imports the source's types and SDK — because a field rename at the source should change one file, not every entity and DTO. [check: dependency-cruiser: source SDK and types importable only from the adapter module]
11. Feed derived indexes and other side effects from an outbox row written with the projection write ([house conventions](house-conventions.md) rule 15), never from the repository — because effects buried in persistence are invisible and untestable.
12. Classify failures: a source timeout is retryable; a source shape the adapter rejects is non-retryable, dead-lettered and reported ([errors](errors.md)) — because retrying a contract break only delays the alert.
13. Run backfills and the periodic reconciliation job as producers into the same pipeline, resuming from a watermark with an inclusive bound and an id tiebreaker — because a separate import path drifts from the event path, and a strict `>` on timestamps skips rows that share one.

### Search indexes

14. Serve filters, sorts, ranges and lookups by id from the primary database; use a search engine only for relevance ranking, facets over heterogeneous fields, fuzzy and multi-language matching — because every query served from the index inherits its lag and its rebuilds.
15. Never make the index a system of record or write it inside a request; index asynchronously from the outbox, re-reading the primary before indexing — because an index written in the request path diverges on the first partial failure.
16. Index with external versioning (a monotonic source version, such as a row version, on every index and delete) so the engine enforces [house conventions](house-conventions.md) rule 16, and treat a version conflict as success — because retries and replays otherwise let an old document overwrite a newer one.
17. Qualify document ids with the scope (`<scope>:<sourceId>`) and make scope a required argument of the search port that every query filters on — because a shared id space with optional filters leaks results across scopes. [check: tsc: the port's `search` takes a non-optional scope]
18. Declare mappings explicitly with unknown fields rejected (`dynamic: strict`), created only by migrations ([schema migrations](schema-migrations.md)) — because dynamic mapping guesses types once and the wrong guess is permanent.
19. Change a mapping by creating a new versioned index, filling it from the primary (not the old index), replaying the outbox from a checkpoint taken before the fill, then swapping the alias in one atomic call — because rebuilding from the old index carries its gaps forward, and a fill without a replay loses the writes made during it.
20. Applications read and write only through aliases, never concrete index names — because a hard-coded index name turns every rebuild into a code change.
21. Put updateable synonym filters only in a `search_analyzer` and reload them through the reload-search-analyzers API; never close an index to change analysis — because index-time analyzers reject updateable filters, and a closed index is an outage.
22. Paginate deep result sets with `search_after` over a point-in-time and a unique tiebreaker sort, capping `from`+`size` for the first pages only — because deep offsets are slow, capped by the engine, and inconsistent while the index changes.
23. When the engine is unavailable, return a degraded response with an explicit flag (from the primary, less relevant, or an error the client can show); never an empty page that looks like "no results" — because users and callers act on false emptiness.
24. Detect drift with a scheduled reconciliation that compares ids and versions between primary and index and re-enqueues the differences, not with checks on the read path — because read-path checks add latency and only see what someone happened to query.

## Example

The indexing step that is easy to get wrong: re-read, delete on not-found, and let the version reject stale writes.

```ts
async function indexArticle(scope: Scope, event: ArticleChanged): Promise<void> {
  // re-read the primary, soft-deleted rows included: only the id comes from the event
  const row = await articles.findByIdIncludingDeleted(scope, event.payload.articleId);
  if (row === null) return; // never existed: reconciliation removes strays
  const id = `${scope.id}:${row.id}`;
  try {
    if (row.deletedAt !== null) {
      // the soft delete bumped the row version, so it outranks the last indexed update
      await search.delete({ index: 'articles', id, version: row.version, version_type: 'external' });
    } else {
      await search.index({ index: 'articles', id, document: toSearchDocument(row), version: row.version, version_type: 'external' });
    }
  } catch (err) {
    if (isVersionConflict(err) || isNotFound(err)) return; // a newer write already landed, or nothing to delete
    throw err;
  }
}
```

`articles` is an alias. Without `version_type: 'external'`, a retried job that re-read before a newer update can still overwrite that update.

## Signs of legacy

- Source SDK or CMS client imported in API resolvers or controllers for query-heavy reads.
- Webhook handlers that write to the database directly, or read the scope from `req.body`.
- Not-found errors on re-fetch marked non-retryable in the sync worker.
- `client.index(` or `client.update(` called from request handlers; no `version_type` on index calls.
- Concrete index names (`articles-v3`) in application code; `dynamic: true` or no mapping; `_close` in scripts.
- `from:` values computed from page numbers on search endpoints; empty results returned from a `catch`.
- A nightly full import as the only sync.

## Notes

### CMS as source

- Hosted headless CMS: verify its signed webhooks, dedupe on its event id, re-read through its published-content API, never the preview or draft API.
- Self-hosted CMS: write an outbox row in the CMS database inside the same transaction as the change (some CMS hooks run before commit, so a fetch fired from the hook can see uncommitted or old data).
- Keep the CMS database and the projection store separate; the application never connects to the CMS database.
- Project only published content, once per locale you serve; drafts stay in the CMS.
- Relationships and taxonomies are shaped in the adapter: denormalise taxonomy ids into an array by default, a separate collection only when taxonomies change often.
- If the CMS has no entry version, use its last-updated timestamp plus id as the monotonic version.

### Elasticsearch and OpenSearch

- Index names `<entity>-v<N>` behind an alias `<entity>`; the swap removes and adds in one `_aliases` request.
- External versioning works with full `index` operations, not partial `_update`.
- Delete tombstones are kept only for `index.gc_deletes` (60 seconds by default); keep the source's soft-delete version, and let reconciliation remove documents an old replay resurrects.
- Elasticsearch synonyms sets (the synonyms API) reload the analyzers that use them; file-based updateable synonyms need the reload call. OpenSearch offers its own refresh-search-analyzers operation; check your distribution.
- Boosts and field weights live in query code under review, with a small fixture corpus test, not score assertions in unit tests.
- Point-in-time search exists in Elasticsearch 7.10+ and OpenSearch 2.4+.

### PostgreSQL full-text

- Enough when the corpus fits one database, one or two languages, and no heavy faceting: a generated `tsvector` column with a GIN index, `websearch_to_tsquery` for user input.
- `pg_trgm` with a GIN index covers typo tolerance and `ILIKE '%term%'`.
- Choose the text search configuration per column explicitly; the default configuration depends on server settings.
- Moving to a search engine later is a new derived index, not a migration of the primary.

### Vector stores and embeddings

- Store the embedding model name and version on every vector row; a model change is a new index or column filled from the primary, then a swap.
- Apply the scope filter inside the nearest-neighbour search (pre-filtering), not on the top-k afterwards — because post-filtering returns fewer than k results and can surface other scopes' rows before filtering.
- With pgvector HNSW and a `WHERE`, results can fall short of `LIMIT`; use iterative index scans (0.8+) or partition by scope.
- Chunks carry their source id and source version so deletes and updates remove every chunk of a document.
- Combine lexical and vector results with rank fusion when exact terms (codes, names) matter.
