# iOS application status and history acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

## Actions and status rules

- Application details support status updates/new history for applied, interviewing/assessment, offer and rejected. Each save creates a history entry instead of directly replacing application status.
- Timeline entries can be edited or deleted with confirmation. Edit the event date, stage and notes. The server soft-deletes entries.
- Use the returned `job.status`. The server selects the latest eligible active history by descending `date`, `createdAt` and ID. With no eligible history it falls back to `applied`.
- History with `statusApplied: false` remains history-only. Editing/deleting it cannot turn old mail into the current status.
- Mail subject/sender, existing appointment times and deadlines are read-only in this milestone. A status event date is not an appointment/deadline.
- Save only `status/date/interviewStage/notes`. Preserve provenance, eligibility, schedule and reminder fields. Send millisecond UTC ISO dates; display/select in the phone timezone.
- UI follows the existing language preference. User content keeps its original language.

## Refresh, failure and ownership

After a successful write, update lists/details with the server response and reload schedules. Older list/detail responses cannot overwrite confirmed edits. Pull-to-refresh and foreground refresh reload both application and history, including web edits; this is not background real-time push.

Disable repeated history writes for the same application and prevent dismissing a saving editor. Failures preserve the form and original data. An uncertain POST result instructs the user to refresh before creating another entry; no automatic POST retry or new server idempotency key was added.

Map 400/404/409/429 to validation/unavailable/conflict/rate-limit feedback. A 401 clears user, applications, history and session. A 404 does not distinguish nonexistent from unauthorized records. Reuse NextAuth and server user/parent checks; never trust a client user ID. Demo history is memory-only and resets on exit.

## Acceptance method

`HistoryTests` cover field allowlists, millisecond precision, UTF-16 length boundaries, provenance/old-mail eligibility, sorting/deletion/fallback, server status authority, errors, logout cleanup and out-of-order list/detail responses. Simulator UI covers assessment/interview creation, stage/notes, offer creation, editing to rejected, cancelled/confirmed deletion and the English editor, plus existing application/language regressions.

After a local production build, `ios/scripts/verify-backend.mjs` uses temporary MongoDB, NextAuth and an iPhone simulator to log in, create/edit applications and perform history CRUD. Relaunch verifies Keychain recovery and persisted status/notes; database assertions inspect active/deleted history. An isolated Chrome profile reads App changes and edits history; App refresh sees those web changes. Direct HTTP attempts reject unauthenticated requests, other users, wrong parents and protected fields without changing another user's data.

## Results on 2026-10-19

- 26 iOS unit tests passed, including 10 new history/stale-response tests.
- Existing application/demo/language UI tests passed. New history CRUD and English-editor UI tests passed after a locator fix and separate rerun.
- Two real-backend UI tests and same-database Chrome acceptance passed, including relaunch, web refresh, bidirectional reads and direct unauthorized HTTP attempts. In total, 31 distinct iOS tests passed; skipped integration tests were not counted as passes.
- `node --test --test-concurrency=1 tests/jobEditing.test.js`: 25 server regressions passed.
- Debug simulator, unsigned iPhone arm64 Release, Next.js production build, script ESLint, project/plist and diff checks passed.
- Reviewed the [native history screenshot](../ios/docs/iphone-history.png) and web timeline capture. Physical devices, signing and TestFlight were not accepted.

Only temporary accounts/databases/browser profiles were used. No production data or real mailbox was accessed.
