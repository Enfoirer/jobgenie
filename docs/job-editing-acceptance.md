# Application and status-history editing

## Selective integration

Reviewed `origin/testing` through `4ec7252` and its `86fa540` editing work.
Reused the application editor, history editor/delete workflow, posting URL field
and board/timeline entry points. The analytics, todo and broader layout changes
on that branch are outside this integration. No new application dependency is
required; dialogs use React portals and the browser's native dialog element.

The testing branch's implementation was adapted rather than copied wholesale:

- Fix the history delete request's undefined `statusId`.
- Bind every history mutation to its ID, parent application and authenticated
  owner. A different application belonging to the same user is also rejected.
- Reject protected/unknown fields, invalid statuses, empty required names,
  invalid calendar dates and unsafe posting URL schemes.
- Save the history and resulting application state in one MongoDB transaction.
- Handle history dates moving both earlier and later, deleting the latest entry,
  tied timestamps and removing the final entry.
- Retain immutable email provenance, ordering protection and retry identity from
  the first two implementation stages.

## User behavior

The board's **Edit Job** action edits company, position, location, notes and
posting URL. Empty optional fields clear their previous values. Posting links
open in a separate tab without opening the timeline. Status changes retain their
dedicated **Update Status** action.

Open an application's timeline and select **Edit History** to edit status,
interview stage, event date/time, notes, appointment time or deadline. Delete asks
for confirmation. Saving/deleting returns the authoritative updated application
to the board and reloads the timeline. A page refresh reads the persisted values.

The native dialogs support keyboard focus containment/restoration, Escape,
backdrop dismissal and mobile scrolling. An inner editor stays above its timeline;
closing it keeps the outer dialog and its scroll lock. While saving, buttons,
fields and dismissal are disabled. A failed save leaves the form open with its
values and an error so the user can retry. Dragging a card opens the status editor
with the destination selected; cancelling leaves the saved board unchanged.

## State and email rules

1. Current status follows the newest active, eligible history entry by `date`,
   then `createdAt`, then `_id`. API history ordering uses the same tie breakers.
2. Moving a date or changing an eligible status recomputes current state. Notes
   and scheduling edits alone leave the current-state watermark unchanged.
3. Deleting the latest eligible entry selects the previous one. If no eligible
   history remains, the application returns to **Applied**.
4. Email entries with `statusApplied: false` remain history only. Editing them
   does not promote them. Appointment/deadline dates never determine current state.
5. Status-affecting manual changes establish a server-time watermark, preventing
   older mail from overwriting them. Incoming mail also respects an active manual
   history that the user has assigned a later event date.
6. History deletion sets an internal `deletedAt` marker. Deleted entries disappear
   from timelines and event statistics; their unique source key remains occupied
   so a retry cannot recreate a deleted email event. There is no restore action.
7. All manual mutations share the per-user transaction lock used by email writes,
   preventing partial results and stale concurrent state updates.
8. Application creation now records its initial history atomically. The Add Job
   page no longer makes a second, independently failing history request.

All read/write queries are scoped to the authenticated user. Missing and foreign
records return 404, invalid inputs return 400, and missing login returns 401
before connecting to the database. Ownership, provenance, deletion markers and
ordering watermarks cannot be written through the client payload.

## Verification

Completed: all **122** automated tests pass, scoped ESLint (including JSX/MJS)
and `git diff --check` pass, and the local production build passes. Browser
acceptance passes all six groups below, with no uncaught browser exceptions:

| Browser check | Result |
| --- | --- |
| Real credential login and board load | Pass |
| Failed save retains input; retry and full reload preserve all five fields | Pass |
| Escape cancels editing and restores page scrolling | Pass |
| Nested history editor, focus and Escape; board/timeline refresh together | Pass |
| Move event date, cancel deletion, confirm deletion and recompute state | Pass |
| HTTP ownership/parent binding, statistics, 390px mobile dialog and 401 | Pass |

`npm test` runs the isolated replica-set tests, including application editing,
ownership/parent binding, history date reordering, deletion/fallback, immutable
provenance, soft-delete replay protection, transaction rollback and concurrent
manual/email processing, alongside the previous mail regressions.

After `npm run build`, `npm run test:ui` starts its own disposable MongoDB, local production Next server and fresh
headless Chrome profile. It performs real login, failure/retry and persistence
checks, nested dialog/Escape checks, history update/reorder/delete, HTTP access
checks, statistics and mobile layout checks. It uses no real account or production
database, installs no browser package, and removes its temporary profile afterward.
Chrome defaults to the macOS application path; set `CHROME_BIN` elsewhere.
The script disables experimental Node server webstorage when available to keep
local Node 25 compatible with the currently installed Next server.

Production compilation is verified separately with `npm run build` and Vercel.
The repository locks Next 15.5.28; the existing local installation is still
15.3.1, so the Vercel result is the check of the locked production dependencies.

The schema additions (`Job.jobUrl`, `StatusHistory.deletedAt`) need no index
migration. Existing histories without `deletedAt` remain visible. Existing jobs
are not bulk rewritten; restarting development processes loads the new schemas.
