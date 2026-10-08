---
type: pattern
---
# Data lifecycle

How data is kept, copied, deleted and recovered across every place it lands: primary databases, replicas, caches, indexes, object storage, logs, exports and backups.

## When it applies

- Applies: every system that stores personal or business data, from the first table onwards.
- Does not apply: purely derived, non-personal data that can be rebuilt at will (it still needs rule 1's inventory entry, saying so).

## Rules

### Inventory and retention

1. Every store that holds data (table, collection, index, bucket, cache, log group, export, backup) is listed in the repository's architecture map with its owner, what personal data it holds, its retention period and how deletion reaches it — because data nobody listed is data nobody deletes.
2. Retention is the shortest period the purpose needs, enforced by a mechanism (TTL, lifecycle rule, scheduled purge job), never by intention ([scheduled jobs](scheduled-jobs.md)) — because "kept just in case" is a liability under data protection law, not a safeguard.
3. Logs and traces carry no personal data beyond an opaque user id ([house conventions](house-conventions.md) rule 25), so erasure never has to edit them — because rewriting log archives is impossible in practice.

### Deletion

4. Soft delete (`deleted_at`) exists only for a stated undo or audit window; after it, personal data is hard-deleted or irreversibly anonymised by a job — because soft-deleted personal data is still stored personal data.
5. Repositories exclude soft-deleted rows by default, and unique constraints that must allow re-creation are partial (`WHERE deleted_at IS NULL`) — because one forgotten filter resurrects deleted data, and a full unique index blocks re-registration. [check: test: a soft-deleted row is invisible to every list and lookup, and its unique value can be reused]
6. An erasure request becomes one recorded event, published through the outbox, that every holder of a copy consumes idempotently and confirms: read models, search indexes, caches, object storage, analytics exports ([outbox](outbox.md)) — because deleting the primary row alone leaves the person findable in search and in caches.
7. Erasures are tracked to completion against a deadline, and the log of erased ids (opaque ids only) is kept for as long as any backup that predates it — because a restore must be able to re-apply them.
8. Offboarding a scope (a customer leaving) exports what is owed, deletes across every store in rule 1 and produces a verification report ([multi-tenancy](multi-tenancy.md)) — because offboarding is the largest erasure you will run, and the one most likely to be audited.

### Backups and recovery

9. Every production database has point-in-time recovery enabled, with its recovery point and recovery time objectives written in the architecture map — because "we have backups" without numbers means nobody knows what a restore loses or how long it takes.
10. Restores are tested on a schedule: restore into an isolated environment, run verification queries, re-apply erasures, and record the time taken against the objective — because an untested backup is a hope, and the first real restore is the worst time to learn the runbook.
11. Backups are encrypted and copied to a separate account or region whose deletion is protected from production credentials — because ransomware and a mistyped command both start with the production account.
12. Backups expire within a stated window, and that window is the erasure promise for backed-up data — because erasure cannot reach into immutable backups, so expiry is what makes the promise true.

### Object storage

13. Blobs live in object storage and the database holds their metadata; the object is written first under a generated key, then the metadata row commits, and a sweeper deletes objects older than a grace period that have no metadata — because the reverse order leaves rows pointing at nothing, and orphans are unavoidable without a sweeper.
14. Deletion removes the metadata first, then the object asynchronously; with versioning enabled, every version is deleted — because a delete marker on a versioned bucket hides an object without erasing it.
15. Object keys are generated (`<scope>/<kind>/<uuid>`), never the uploader's filename; content type and size are validated before the metadata commits — because user-controlled keys enable overwrites, path tricks and content sniffing.
16. Pre-signed URLs are issued only after an authorization check, for one object and one method, with an expiry of minutes, and uploads constrain size and content type in the signed policy ([authentication and authorization](authentication-and-authorization.md)) — because a pre-signed URL is a bearer credential anyone holding it can use.
17. Buckets are private with public access blocked; public delivery goes through a CDN with signed or scoped access — because one public bucket setting exposes everything in it.

### Replicas and analytics

18. Reads that follow a write in the same user flow, and every read-modify-write, use the primary; replicas serve only reads that tolerate the stated lag, and routing falls back to the primary when measured lag exceeds it ([repositories](repositories.md)) — because a user who saves and then sees the old value files a bug, and a decision made on lagged data is wrong.
19. Analytics and reporting never query the primary: data reaches them through change data capture or scheduled exports, minimised or pseudonymised, and erasures propagate to them too — because a heavy report on the primary is an outage, and an export is another copy rule 6 must reach.

### Audit and legally retained records

20. Audit trails and records kept under a legal obligation (invoices, consent, security events) are written append-only to a separate store with its own retention set by that legal basis, holding opaque ids rather than personal details; they are exempt from ordinary erasure only where the law requires retention, and each erasure request is itself recorded there — because audit data mixed into business tables is either erased with them, breaking the obligation, or kept with them, breaking the erasure.

## Example

Attaching an uploaded file: object first, metadata second, sweeper as the backstop.

```ts
async function attachDocument(scope: Scope, ownerId: string, upload: Upload): Promise<Document> {
  const objectKey = `${scope.id}/documents/${randomUUID()}`; // never the uploaded filename
  await storage.put(objectKey, upload.body, { contentType: upload.contentType });
  try {
    return await documents.insert(scope, { ownerId, objectKey, size: upload.size });
  } catch (error) {
    // Best effort: the orphan sweeper deletes it later if this fails too.
    await storage.delete(objectKey).catch((cleanup) => logger.warn('orphan left', { objectKey, cleanup }));
    throw error;
  }
}
```

For direct browser uploads to a pre-signed URL, the object lands first by construction; the confirmation call validates it and commits the metadata.

## Signs of legacy

- `deleted_at` columns with no purge job; unique indexes on soft-deletable tables without a `WHERE deleted_at IS NULL`.
- Deletion code that touches only the primary table; no erasure event or consumer in read models, search or caches.
- Object keys built from `file.originalname` or `file.name`; buckets or objects with public ACLs.
- Pre-signed URLs with expiries of days; issued without an authorization check.
- Reporting queries or BI tools connected to the primary database.
- No record of the last successful restore test.

## Notes

### PostgreSQL (RDS / Aurora)

- Automated backups give point-in-time recovery within a configurable retention window (up to 35 days); a restore creates a new instance or cluster, so the runbook includes the cutover.
- Copy snapshots to another account or region for rule 11; logical dumps serve long-term archives that must survive engine upgrades.
- Replica lag is visible per replica (`pg_stat_replication`, or the managed service's lag metric); alert on it and use it for routing.

### MongoDB (Atlas)

- Continuous cloud backup provides point-in-time restore into a cluster; restore into a separate cluster for tests.
- Self-managed deployments need oplog-based backups for point-in-time recovery; snapshots alone restore only to the snapshot time.
- TTL indexes delete expired documents in the background, roughly every minute: fine for retention, not for exact cut-offs.

### S3

- With versioning on, deleting an object adds a delete marker; erasure deletes each version, and lifecycle rules expire noncurrent versions.
- Lifecycle rules also abort incomplete multipart uploads, which otherwise accumulate cost silently.
- Object Lock in compliance mode blocks deletion even by administrators: use it for backups, never for personal data you may have to erase.
- Keep Block Public Access on at account and bucket level.

### DynamoDB

- TTL deletes expired items in the background, typically within days, not at the expiry time: filter expired items in reads.
- TTL deletions appear in the table's stream, so consumers can propagate them to copies (rule 6).
- Point-in-time recovery restores into a new table, within a recovery period of up to 35 days; export to S3 (which requires it) feeds analytics without consuming table capacity.
