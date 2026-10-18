# In-app reminders

## User rules

Open **Reminders** using the bell and unread count in the dashboard header.
Reminders use the same appointment/deadline projection as Calendar & To-do.

| Rule | Behavior |
| --- | --- |
| Default | Enabled, one hour before each appointment or deadline |
| Lead time | Choose 15 minutes, 30 minutes, 1 hour or 24 hours; one setting applies to both event kinds |
| Window | Opens at `event time - lead time`, ends at the exact event time |
| Repeat | One stable item per occurrence; leaving it unread does not create additional items |
| Read | Persists across refresh/login/devices and stops repeats for that occurrence |
| Snooze | Hides it from the unread count for 10 minutes, then makes the same item unread once; a user may snooze again |
| Snooze limit | Available only if more than 10 minutes remain; repeated in-flight requests do not extend the delay |
| Cancel reminder | Suppresses that occurrence without deleting the calendar/history; cannot be undone by stale read/snooze requests |
| Reschedule | Cancels the old occurrence and creates a new reminder version, including A → B → A changes |
| Clear/delete | Clearing a timestamp or deleting the history/application removes its reminder immediately on refresh |
| Closed application | Offer/Rejected stops reminders while preserving the calendar; reopening resumes eligible unhandled reminders |
| Preferences | Changing lead time or disabling/re-enabling preserves read/cancelled choices; active snoozes keep their original wake time |
| Missing/elapsed time | Missing dates never trigger; at/past the scheduled time, use Calendar & To-do instead |

An appointment and deadline on one history are independent reminders. Changing
one timestamp resets only its state. Notes, company/position edits, and equivalent
timestamp strings do not retrigger reminders. Handled items appear in the Handled
tab only while their current reminder window is open; this is not a permanent
notification archive. Events newly added within their lead window appear on the
next refresh; events already elapsed do not create catch-up alerts.

This is in-app delivery: the dashboard polls every 30 seconds while visible,
refreshes on navigation/focus/visibility, and refreshes immediately after local
schedule edits/deletion. An unopened or background app does not send an email,
OS notification or browser push. No cron service is needed. Times are compared
as UTC instants on the server and displayed in the browser's local time zone.

## Persistence and concurrency

User preferences live in `User.reminderSettings`. Per-kind `reminderRevision`
and `reminderState` live on the original StatusHistory record. Existing records
default to revision zero, unread, enabled and a one-hour lead; no bulk migration
or new unique index is needed. The history editor cannot directly write these
protected fields.

GET `/api/reminders` derives the reminder list from the current owner-scoped
schedule plus saved state. Repeated/concurrent reads create no delivery rows.
Missing/deleted/foreign-parent histories cannot leave detached reminders. The API
responds with `Cache-Control: private, no-store`; stale or aborted client responses
cannot overwrite newer refreshes. Load failures show an error instead of claiming
there are zero reminders; action failures retain the item for retry.

PATCH `/api/reminders` accepts only history ID, kind, revision and action. It
checks owner, parent ownership, revision, current preferences, application status
and time window inside the same per-user transaction used by mail and manual
edits. Stale occurrences return 409, missing/foreign records 404, invalid input
400 and unauthenticated requests 401. Snooze cannot undo a read/cancel; cancelled
state wins over stale actions. PATCH `/api/reminders/settings` validates an exact
boolean and one of the supported numeric lead times. Neither API changes history
dates, the current job status or its status-event watermark.

## Verification

All 161 automated tests, the combined editing/calendar/reminder browser acceptance,
scoped ESLint and the local production build passed. Browser acceptance includes
390px layout and records no uncaught JavaScript exceptions.

`npm test` adds 22 reminder tests (161 total) covering boundaries, missing/elapsed
events, per-kind independence, read-only stable polling, persistence and settings,
10-minute snooze, idempotent retries, cancellation, A → B → A, equivalent dates,
deletion/clearing, closed/reopened applications, protected inputs, owner/parent
isolation, concurrent actions/rescheduling, rollback and API authentication.

After building, `npm run test:ui` includes `scripts/verify-reminders-ui.mjs` in the
existing disposable-database Chrome harness. It checks the badge, read after
reload, snooze and wake (the fixture's snooze time is moved backward instead of
waiting ten minutes), cancellation, lead settings, disable/re-enable, calendar
rescheduling, stale HTTP actions, ownership, a simulated failed save/retry,
mobile layout and unauthenticated access. It sends no external notification and
does not access the production database.

Local compilation uses the existing installed Next 15.3.1; the deployment lock
remains Next 15.5.28. Vercel separately verifies the locked production version.
