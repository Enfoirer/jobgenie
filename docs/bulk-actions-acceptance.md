# Bulk actions acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

Original delivery: 2026-10-30. Scope: web, native iPhone UI and shared backend.

## Behavior

- Web board selection and iPhone bulk selection support archive/restore/status changes, including restore from archived views. Web/native pending-mail lists support bulk accept/ignore.
- Up to 50 items with confirmation. Independent per-item transactions return success/failure counts/errors. Clear successful selections; retain failures for retry.
- Accept only explicit existing/new-application targets. Incomplete mail remains pending without guessing. Web submits current form edits; App uses stored review fields, with individual review for changes.
- Archive preserves applications/history/statistical contribution but hides them from active lists/schedules/reminders. Restore shows eligible events/reminders and preserves read state. Mail can still match archived applications without auto-restoring them.
- Status changes reuse history rules; repeated same-status submissions do not duplicate history. If future-effective history prevents the requested current status, roll back that item.
- Accepted mail reuses source deduplication; ignoring creates no history. Check ownership per item; unauthorized/nonexistent both return 404.

## API

- `POST /api/jobs/bulk`: `{ ids, action: "archive" | "restore" | "status", status? }`.
- `POST /api/pending/bulk`: `{ ids, action: "accept" | "ignore", updates? }`; updates are indexed by mail ID.
- Response `{ total, succeeded, failed, results }`: per-item ID/success, application or linked ID on success, status/error on failure.
- `GET /api/jobs` defaults to active applications; `includeArchived=true` includes archives, still only for the current user.

## Recorded acceptance

- `npm test`: 266 passed. Ownership, transaction rollback, concurrency/retries, mail provenance and history/schedule/reminder/statistics regressions covered.
- `node scripts/verify-job-editing-ui.mjs --bulk-only`: isolated database/real browser verified login, selection/status, archive refresh persistence, restore, partial mail failure/retained selection, retry ignore and narrow layout.
- iOS units: 73 passed, one existing independent-service test skipped. All eight new `BulkTests` passed: archive/restore state, partial failures, duplicate status, uncertain targets, limits/actions/results, legacy data, API contract and logout cleanup.
- `testDemoBulkArchiveRestoreAndMailReview` passed selection/archive/restore/mail confirmation/logout in the simulator.
- Production build passed with local placeholder environment variables, without production database access. `git diff --check` passed.

Tests used isolated databases, native demo data and API stubs. These results alone do not establish Vercel deployment or TestFlight distribution; deployment observations are recorded separately.
