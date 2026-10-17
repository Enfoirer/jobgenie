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
The response includes per-run counts and per-account backlogs (see below);
errors identify the stage, account ID and message ID when available. `emails` continues to contain newly stored mail,
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

Improved AI extraction/matching, retry controls in the UI, and business rules
for out-of-order distinct emails remain separate work. Historical gaps caused by
the old implementation are not automatically repaired.

## Pagination and request boundaries

Both HTTP entry points use `createMailSyncHandler`. Authentication remains
separate: manual sync requires a logged-in user and selects only that user's
accounts; cron requires `CRON_SECRET` and may select accounts across users.

- `limit` defaults to 10 only when omitted. Integers from 1 through 50 are allowed,
  per account per invocation. Empty, fractional, negative, zero, nonnumeric or
  out-of-range values return HTTP 400 before a database connection is attempted.
- `provider` may be omitted, `gmail`, or `outlook`. Unknown providers and repeated
  `limit`/`provider` parameters return 400.
- Provider traversal is also bounded to 10 successful listing/history pages per
  invocation so empty or duplicate-only pages cannot cause an unbounded loop.
  Further pages remain resumable on the next invocation.
- The queue processing budget remains 50 stored messages per account, independent
  of the provider fetch limit. It can include previously failed messages.

Gmail stores `metadata.gmailSync`, including the original history cursor, opaque
page token and unconsumed message IDs. One history record can contain more emails
than `limit`, so leftover IDs must also be retained. `metadata.historyId` advances
only when the final page and its IDs are consumed. Message-level history IDs are
never used to skip ahead. An initial full Inbox scan captures a profile history
baseline **before** listing pages; after full enumeration it starts incremental
history from that baseline to pick up arrivals during the scan.

A Gmail history 404 starts a paginated full scan. Expired continuation tokens
restart from the committed position. Other request failures remain errors and do
not silently fall back to only the latest messages. A message deleted between
listing and detail fetch contributes to `unavailable`, rather than blocking the
entire history scan.

Outlook stores `metadata.outlookSync`, follows Graph's complete `@odata.nextLink`
unchanged, and retains overflowing message bodies when a later request reduces
`limit`. The scan's original URL contains a fixed received-time upper bound.
`lastReceivedAt` advances to the highest observed received time only after all
pages and buffered messages are saved. The next scan uses an inclusive lower
bound, so equal timestamps overlap safely and are deduplicated by message ID.
Invalid/expired continuation links restart at the last completed watermark.
Only HTTPS links to Graph's v1.0 endpoint receive the bearer token.

Continuation state and completed cursors are saved only after the returned batch
is durably queued. A provider failure or an inbox/cursor write failure preserves
the previous committed continuation. Read-only provider adapters never save their
own cursor. All entry points must be deployed together; older code does not
understand the new continuation fields. These added metadata fields need no new
index migration beyond the existing `db:mail-indexes` rollout.

API behavior follows the official
[Gmail history pagination](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list),
[Gmail message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[Graph message listing](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0),
and [Graph paging](https://learn.microsoft.com/en-us/graph/paging) documentation.

## Sync result counts

Aggregate counts are returned at the top level; `accounts` provides the same
counts per account, plus its ID, provider, email address and backlog.

| Field | Meaning within this invocation |
| --- | --- |
| `totalFetched` | Full messages returned by provider adapters for ingestion, including duplicates |
| `stored` | Newly inserted durable queue rows |
| `skipped` | Returned messages already in the queue or legacy deduplication records |
| `processed` | Queue processing attempts committed successfully |
| `applied` | Successful processing routed to automatic job/history updates |
| `pendingReview` | Successful processing routed to human review |
| `irrelevant` | Successful processing classified as irrelevant/non-status mail |
| `failed` | Processing attempts that threw; not the number of provider errors |
| `retried` | Claimed rows whose attempt count is greater than one |
| `pagesFetched` | Successful provider listing/history pages; not body/profile requests |
| `unavailable` | Listed Gmail messages whose detail request returned 404 |
| `cursorResets` | Expired cursor/token recovery attempts |
| `errorCount` | Ingestion, processing, queue or summary errors in `errors` |

`processed = applied + pendingReview + irrelevant`. A provider or partial inbox
write failure can leave `totalFetched` greater than `stored + skipped`; inspect
`errors` instead of treating the difference as successfully stored mail.

Each account's `backlog` describes stored state **after** this invocation:
`pending`, `processing`, `failed`, and actual `pendingReview` items awaiting a
human decision. Its `pendingReview` count is distinct from this invocation's
review-routing count. Counts are operational snapshots; concurrent work may
change them after the response is returned.

`hasMore` means a provider continuation or buffered page remains in MongoDB.
`hasPendingWork` means background queue rows are pending, processing or failed;
human review alone does not set it. At the aggregate level each flag is true if
any selected account has that work. Call sync again (or wait for cron) to resume.
If backlog inspection fails, the account's backlog and flags are `null`, and a
`summary` error is returned; unknown state is not reported as an empty queue.

No accounts returns the same response shape with zero counts and an empty
`accounts` array. Per-account operational failures return HTTP 200 with partial
results and `errors`, allowing other accounts and queued retries to proceed.
Authentication, invalid parameters and handler-level failures use 401, 400 and
500 respectively.
