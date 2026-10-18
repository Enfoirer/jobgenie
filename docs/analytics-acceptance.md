# Application analytics

## Metrics and observation period

`/dashboard/analytics` is the canonical analytics page; the old `/dashboard` URL
redirects there. The integration preserves the testing branch's useful ideas
(status summary, progression and trends) with corrected calculations and a shared
API. It does not copy its rejection-as-interview calculation, `offered` typo,
per-application history requests, or unused chart dependency. No package or schema
migration is required.

**Current status distribution** counts every owned, existing Job by its saved
current `status`, at the time of the request. It is deliberately independent of
the selected dates and is labelled accordingly. It is not a conversion funnel.

**Stage conversion** uses an application cohort: Jobs whose `dateApplied` falls
within the selected local date range and is not in the future. For that cohort,
active history entries from the application time through the end of the selected
period establish which stages were reached. Today is capped at server time.

| Metric | Numerator | Denominator |
| --- | --- | --- |
| Applied → Interview / assessment | Cohort applications with interviewing history | All applications in the cohort |
| Interview / assessment → Offer | Cohort applications with an offer event at or after an interviewing event | Cohort applications with interviewing history |
| Applied → Offer | Cohort applications with offer history | All applications in the cohort |

Each application counts once per stage regardless of repeated rounds/emails.
The existing `interviewing` status includes online assessments and is explicitly
labelled **Interview / assessment**. Rejections are reported separately; they do
not imply an interview and are not a required funnel step. An offer without a
preceding interview counts in the overall offer rate, not the interview-to-offer
step. Missing history is reported rather than inferred from Job.status. A zero
denominator produces `null`, rendered as **—**, not 0% or NaN.

Historical emails with `statusApplied: false` are valid stage evidence, although
they do not determine current status. Deleted records and future-dated events
are excluded. Pre-application histories do not establish a cohort stage. Equal
interview/offer timestamps count as a documented transition; an earlier offer
does not. Later offer events after an interview can establish conversion.

The progression table shows the first recorded date of each stage for each cohort
application, 20 applications per page. The observation cutoff matters: a March
application with an April offer is not a March conversion when the selected end
is March 31. Expanding the end date expands both the cohort and its observation
period. Historical edits/deletions intentionally restate these calculations; this
page is not an immutable reporting archive.

## Trends and dates

Daily trends cover all existing applications' activity in the chosen period,
including applications created before it. **New applications** counts dateApplied;
**Status events** counts actual history records, so multiple rounds can appear
on one day even though cohort conversion deduplicates them. Chart-only toggles
never change conversion denominators. An accessible daily count table accompanies
the chart. Appointment/deadline times are not used as status-event dates.

`GET /api/stats` accepts either `days` (integer 1–366, default 30) or both ISO
`start`/`end` calendar dates, plus `timeZone` (IANA ID; API default UTC). The UI
defaults to the browser zone and offers 7/30/90/365-day presets and custom dates.
Dates are inclusive in the chosen zone, implemented as `[local start midnight,
midnight after end)`. Future end dates, malformed/nonexistent dates, reversed or
overlong ranges, invalid zones, repeated/unknown parameters and mixed range forms
return 400 before database access.

Boundaries are determined for each local date, not by adding fixed 24-hour periods
or using the server's local zone. DST 23/25-hour days, fractional offsets, midnight
clock jumps and skipped local dates are handled. Buckets are zero-filled in
ascending local-date order; future records cannot append unexpected extra days.

The Add Job form now initializes today's date in the browser zone and sends the
chosen local midnight as a UTC timestamp. Existing timestamps remain unchanged:
legacy date-only inputs were stored as UTC midnight, and their original intended
zone cannot be recovered reliably. Those records are interpreted in the selected
reporting zone using the stored instant.

## API and consistency

The response separates `currentStatus`, `cohort` (reach, numerator/denominator,
rates and detail rows), `timeline`, and `range` (zone, exact bounds and observed
through time). The misleading old `funnel` property is removed; all repository
consumers use `currentStatus.counts` instead. Daily buckets add `applications`
alongside the four status-event counts.

Authentication precedes DB work. Both Jobs and histories are owner-scoped; exact
parent binding excludes orphaned or cross-owner history. A read-only MongoDB
snapshot transaction keeps all counts/details consistent during concurrent edits.
Responses are private/no-store. The page refreshes on mount, focus/visibility,
local history mutations and each visible minute. Aborted older requests cannot
overwrite newer ranges. Failures are visible and retryable, never silently zeroed.

## Verification

Verified: all 183 automated tests, combined editing/calendar/reminder/analytics
browser acceptance, scoped ESLint and the local production build pass. The mobile
analytics screenshot was inspected; chart and table overflow stays within their
own scroll containers, and no uncaught browser exceptions were recorded.

`npm test` adds 22 analytics checks (183 total) for defaults/validation, local
midnight, exclusive upper bounds, future cutoffs, DST, half-hour offsets, midnight
DST gaps, leap/skipped dates, cohort versus current counts, repeated stages,
direct offers/rejections, order/equal times, historical email, observation period,
empty denominators, missing/invalid history, schedule-date independence, mutation
refresh, owner/parent isolation and authenticated/cache-safe API behavior.

`npm run test:ui` includes `scripts/verify-analytics-ui.mjs` in the existing
disposable MongoDB/Chrome acceptance harness. It verifies the old URL redirect,
displayed fractions and rates, chart-only filters, time-zone cohort changes,
historical cutoff, invalid zone recovery, history-deletion refresh, empty ranges,
simulated 503/retry, local date creation, mobile chart/table overflow and 401.
It uses no production account or database.

The local installation remains Next 15.3.1; the repository lock is 15.5.28.
The local production build and Vercel deployment verify these separately.
