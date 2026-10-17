# Durable email processing

## Processing order

Both `/api/mail` and `/api/mail/cron` call `syncMailAccounts`:

1. Fetch the provider batch using the existing cursor.
2. Upsert each full message in `ProcessedEmail`, uniquely keyed by account and
   provider message ID, with majority write acknowledgement.
3. Advance the account cursor only after every message in that batch is saved.
4. Drain stored work, including work left over from previous syncs. Provider
   errors and empty batches do not prevent retries.
5. Claim a row atomically, parse outside a transaction, then commit all database
   effects and its success marker in a single transaction.

`status` describes processing, independently of whether a human accepts a review:

- `pending`: safely stored, not yet claimed.
- `processing`: claimed with a unique lease token and a five-minute lease.
- `failed`: processing failed; the next sync can claim it again.
- `succeeded`: all writes committed. `outcome` is `skipped`, `pending_review`, or
  `applied`.

`attempts`, `lastError`, `processedAt`, and `jobId` support inspection in MongoDB.
The response adds `processed`, `failed`, and `retried`; errors identify the stage
and message ID when available. `emails` continues to contain newly stored mail,
not the entire retry backlog. No separate retry endpoint is necessary: invoke
manual sync or the existing cron again. Each account processes up to 50 queued
messages per invocation, with oldest-updated work first. Failed attempts move to
its tail, and are not retried in a tight loop within the same invocation.

## Atomicity and duplicate protection

The queue's account/message unique index prevents duplicate inbox rows. A claim
is a conditional update, so simultaneous manual and cron calls cannot own the
same lease. An expired lease may be reclaimed after a worker crash. A worker
whose token was replaced cannot commit effects or change the new owner's state.

The transaction includes the queue success marker and either the review item or
both Job and StatusHistory. Any business write failure rolls the entire
transaction back. A stable email source key on StatusHistory has a partial unique
index. Pending acceptance uses the same key, and saves its review status and
business writes in a transaction as well. Repeated acceptance returns the
previous result. Manual history entries without a source key remain supported.

An extraction API/network error, timeout, empty response, or malformed JSON now
throws instead of silently falling back to a completed result. Having no
`OPENAI_API_KEY` still uses the existing optional rule-only behavior.

## Deployment / existing database

MongoDB **must support transactions**, using Atlas or a replica set. There is no
non-transactional fallback. If transactions are unavailable, full emails remain
stored and processing fails visibly rather than committing partial effects.

Before enabling the updated sync against an existing database:

1. Stop old sync workers / scheduler calls during the rollout; old code cannot
   safely interpret the new queue records.
2. Configure `MONGODB_URI` in `.env.local` or the process environment.
3. With Node.js 22.12+ run `npm run db:mail-indexes`.
4. Deploy all entry points together, then resume the scheduler.

The idempotent index script creates the queue and source-event indexes, creates
an account/message index for PendingItem, then removes only the old
user/message/provider unique index. It preserves documents and unrelated indexes.
If index creation reports inconsistent existing data, resolve it before enabling
sync; the script intentionally does not delete or deduplicate business data.

Legacy ProcessedEmail rows have no status or raw payload. They remain deduplication
markers and are **not automatically replayed**: the previous pipeline did not
record whether each business write succeeded. This update cannot reconstruct
historical lost messages that are no longer fetched. Review/import those
separately if historical recovery is required.

## Tests

Run `npm install`, then `npm test` with Node.js 22.12+. Tests start a disposable
MongoDB replica set using `mongodb-memory-server`, use real Mongoose models,
transactions and unique indexes, and delete only their own temporary database.
The initial run needs network access to download the MongoDB binary; it is cached
under `/private/tmp/jobgenie-mongodb-binaries`. No production credentials, real
mailbox access, or paid API calls are used.

Tests cover partial ingestion, cursor-save failure, parser/API failure, pending
writes, rollback between job/history/completion writes, replay, concurrent sync,
expired/live/replaced leases, concurrent pending acceptance, mailbox isolation,
and legacy rows.

Provider pagination/backfill, improved AI extraction/matching, retry controls in
the UI, and business rules for out-of-order distinct emails remain separate work.
This change guarantees durable processing of fetched batches, not completeness
of the existing provider fetch/pagination logic.
