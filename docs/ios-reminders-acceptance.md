# iOS in-app reminder acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

Reuse `/api/reminders` and `/api/reminders/settings`. This document records the original in-app-only delivery. Follow-up on 2026-11-12 adds opt-in [APNs system notifications](ios-push-acceptance.md), with local tests and outstanding Apple configuration/physical-device acceptance tracked separately.

## Entry points and actions

Open reminders through the schedule bell or Profile. The schedule tab displays unread count. Unread, snoozed and handled lists link to application details. Support mark read, 10-minute snooze, cancellation, enable/disable and lead time. Cancellation preserves application/schedule. Both languages are supported.

Real-account data/settings persist on the shared server across relaunch/login and web refresh. Demo changes last only for that demo session and use no real reminder API. Demo interviews are 30 minutes ahead.

## Rules

- Default lead time: one hour; options: 15 minutes, 30 minutes, one hour, 24 hours. Reminders expire at the event/deadline; missing times have no reminders.
- One reminder per time/version. Refresh, lead-time changes and disable/re-enable preserve read/cancelled state.
- Snooze is 10 minutes and requires more than 10 minutes until the event. Repeating the same snooze does not extend it again. After expiry, refresh restores the same unread reminder.
- Rescheduling creates a new version, including A to B to A. Clearing/deleting history/application invalidates old reminders; Offer/Rejected stops reminders. Interview and deadline are independent.
- Foreground polling every 30 seconds; also refresh on opening, foregrounding, pull-to-refresh and history/schedule edits. Polling pauses in background. No background wake/push guarantee.
- Server defines the window. App filters expired items with server time and a monotonic clock, displays phone-local dates, checks expiry every 10 seconds and revalidates server-side on action.
- Handled items remain only while their reminder window is active; this is not a permanent notification archive.

## Failure and ownership

Send only history ID, schedule kind, version and action. Server checks the signed-in user, parent ownership, current version and window. A stale version returns 409; missing/unauthorized returns 404; App refreshes with feedback. Repeated reads do not create reminder/push records.

Write failure preserves retryable items. If a write succeeds but refresh fails, remove the stale copy and explicitly report the saved action. Confirmed settings also survive refresh failure. First-load failure displays an unknown count. Request sequencing prevents stale replacement. Logout clears reminders/settings/messages and changes the session marker; late responses cannot restore them. A 401 clears login. Rebuild navigation/state across accounts.

## Results on 2026-10-25

55 core, six demo/language UI and five isolated real-backend UI tests passed across runs: 66 distinct iOS tests. 258 server tests passed. Core reminder tests were rerun after final changes; reminder/web interoperability passed independently with `--reminders-only`. Debug simulator, unsigned arm64 Release, ESLint, project/plist and diff checks passed. Reviewed the [reminder screenshot](../ios/docs/iphone-reminders.png).

Coverage includes field allowlists, server time, demo isolation, read/cancel retention, snooze idempotency, rescheduling versions, clearing/deletion, stale responses, recovery, 401 and account switching. Isolated integration checked database state after App actions, web reads/rescheduling, stale/unauthorized writes and App clearing. Commands: [iOS README](../ios/README.md). Only temporary MongoDB and local Next.js were used.

## Original background-push boundary and follow-up

At the original delivery, APNs, device registration, dispatch and push deduplication were not implemented. The [2026-11-12 follow-up](ios-push-acceptance.md) adds those code paths and local acceptance. A developer Team, APNs signing key, suitable scheduler, provisioning and signed physical-device tests are still required before claiming actual Apple delivery. Historical in-app results above are unchanged.
