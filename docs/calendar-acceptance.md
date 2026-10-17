# Calendar and to-do

## Scope and data contract

`/dashboard/todo` adds **Calendar & To-do** to the navigation. A single authenticated
`GET /api/schedule` supplies both the monthly calendar and the task lists. Its
owner-scoped history/application join replaces the testing prototype's sequential
per-application requests. No new package or database migration is required.

- Appointment events use `StatusHistory.scheduledTime`; deadline events use
  `StatusHistory.deadline`. Neither `date` nor email receive time is substituted.
- Interview histories without an appointment appear in **Needs a time**.
  Online Assessment histories without a deadline appear there as missing deadlines.
  The saved stage identifies assessments; original email event type is a fallback
  for older entries with no stage. Correcting the stage overrides that fallback.
- Both timestamps on one history produce two distinct items. They share one
  history editor; deleting that history removes both items. An assessment with a
  known appointment but no deadline still has a missing-deadline item.
- Missing-time membership is derived from the current fields, so a stale original
  AI `needsScheduling` flag cannot override a user's filled or cleared date.
- **Upcoming** includes an event at the current instant; **Overdue / past** means
  its time has elapsed. It does not claim that an assessment was missed or an
  interview was incomplete. Completion tracking and notifications are separate work.
- Offer/rejected applications and history-only emails retain their schedules.
  Deleted histories, deleted applications, orphaned references and mismatched
  owners are excluded. Changing a job's current status does not cancel its events.
- Explicit timestamps remain visible even on non-interview histories. A status
  edit is not treated as an implicit cancellation of an independently saved time.

## Interaction and consistency

The calendar shows all dated items for the displayed month. Selecting a day shows
that day's list; selecting a task category clears the day selection. Missing-time
items are never assigned an arbitrary calendar day. All labels, grouping and date
inputs use the browser's time zone, displayed on the page; storage stays in UTC.

Use **Update Status** on the Job Board to create an interview/assessment with its
appointment or deadline. Existing entries can be edited from the calendar, task
list or timeline using the same history endpoint. Editing just scheduling fields
does not reorder history or change current application state. History deletion
uses the existing transaction, state recomputation and email tombstone protection.

The calendar re-queries after mutation, on mount/navigation, when the window
regains focus/visibility, and every minute while visible. Requests bypass caching;
the API responds with `Cache-Control: private, no-store`. Aborted/stale responses
cannot overwrite newer data. A failed refresh retains the last data with a visible
staleness warning and a retry button. This is refresh-based synchronization, not
a realtime push subscription across browser windows.

## Acceptance

Verified: all 139 automated tests, the combined editing/calendar browser acceptance,
scoped ESLint and the local production build pass. The 390px calendar screenshot
was also inspected; no horizontal page overflow or uncaught browser exception was
observed.

`npm test` includes 17 additional schedule tests (139 total): date provenance,
missing interview and assessment times, two timestamps, original/edited stages,
terminal applications, history-only email, clearing and rescheduling, stale AI
flags, soft deletion, metadata edits, application removal, owner isolation,
orphaned/cross-owner history, stable repeated reads, exact-time boundaries,
Shanghai/Los Angeles midnight and DST, leap months, invalid legacy dates, and
unauthenticated access.

After `npm run build`, `npm run test:ui` runs both the prior editing acceptance and
`scripts/verify-schedule-ui.mjs` against a disposable database and Chrome profile.
The calendar checks real login, local-time day placement, Offer retention, task
counts, editing/clearing/reloading, deletion, timeline-to-calendar navigation,
manual assessment creation, a simulated 503/read retry, ownership and 390px layout.
The test does not use production accounts or send notifications.

For a local build without `.env.local`, supply a local compile-only `MONGODB_URI`
and `NEXTAUTH_SECRET`; the browser harness provides its own actual test database
and secret at runtime. The existing installed Next version is 15.3.1, while the
repository pins 15.5.28 for deployment; production dependency verification is
separate from the local build.
