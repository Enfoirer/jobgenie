# iOS product feedback

Delivery date: 2026-11-07 (Asia/Shanghai). Scope: native iPhone UI and shared authenticated persistence API. No web survey UI or App Store review request is introduced.

## Questions and choices

Account → Rate JobGenie opens the same form used by automatic invitations. Ask, in order:

1. Overall satisfaction with JobGenie: one to five stars, with explicit dissatisfied/satisfied endpoints.
2. Likelihood of recommending JobGenie to a friend: one to five stars, with explicit unlikely/likely endpoints.
3. Suggestions or other feedback: optional plain text, at most 2,000 UTF-16 code units, matching the server limit.

Neither score is preselected. Both scores are required only when submitting; comments are optional. Not now and Never show automatically again remain available without answering. There are no incentives, sentiment filters, positive-only review routing or changes to application/service access. The recommendation question is a five-point rating, not a 0–10 NPS instrument; do not report it as NPS.

The form explains that this is private product feedback, not an App Store review, and that account, app version and language accompany the submission. It asks users not to enter credentials or email contents. UI and accessibility labels support Simplified Chinese and English. Demo actions never call the feedback API or write real preferences/responses.

## Invitation policy

- Invite every eligible real account under the same rules, without selecting by Offer/rejection, successful operations, sentiment or predicted rating. Manual feedback is available even before eligibility or after opting out.
- Eligibility starts with the first server-observed iOS feedback visit. Require seven elapsed days and activity on at least three distinct UTC dates within the last 30 dates. Earlier usage is not invented or backfilled from commits, application counts or account age.
- Also require at least two minutes of foreground use in the current signed-in session and a 30-second quiet period. Only root application/schedule/mail/account lists opt in. Navigation, editors, keyboards, authorization, active writes and another presented controller defer the invitation. Surface conditions are rechecked after network waits. Scroll-phase tracking is used where the OS provides it; background time does not accumulate.
- Each account receives at most two automatic offers for this campaign (`ios-product-v1`). Reserving an offer starts a 14-day minimum interval; choosing Not now starts at least 14 days from that choice. No reminder is sent by email, APNs or browser push.
- Never show automatically again is account-wide and permanent for automatic invitations. Keep this flag when adding future campaigns. The voluntary Account entry remains accessible. A submitted response ends automatic invitations for this campaign.
- Automatic failures are silent and never block the user's work. If a safe surface changes while waiting, retain/retry the same reservation rather than display over the new task. Offered and acknowledged-shown invitations are recorded separately.

This is an experienced-active-user sample, not a representative sample of all registrants. Voluntary-response, nonresponse and availability bias remain. Timing controls reduce interruption and event-trigger bias; they do not eliminate statistical bias.

## Persistence, privacy and concurrency

`GET /api/feedback` reads only the current account's status and existing response. `POST /api/feedback` accepts `visit`, `invite`, `shown`, `later`, `never` or `submit`. Source and user identity are server-derived. POST checks origin, JSON content type and a streamed 12 KiB limit before database access, and allows at most 60 requests per user per minute. Results are private/no-store. Protected fields, invalid integers, malformed IDs/context and oversized/control-containing comments are rejected.

`FeedbackProfile` uses the user ID as its unique key, retaining bounded recent active dates, first observation, at most two invitation records, offered/shown timestamps, dispositions, snooze, permanent opt-out and submission time. This allows analysis of invitations and nonresponses as well as ratings. No email contents, job outcomes, IP addresses or contact lists are copied into the survey records.

`ProductFeedback` stores one immutable response per account/campaign: both ratings, optional comment, manual/prompt source, invitation ID where applicable, app version, UI locale, platform, response time and experience counts at response. Per-user transactions and the deterministic unique response key prevent concurrent/retried submissions from creating duplicates or overwriting an earlier answer. Negative and positive scores use the same path. Text is stored as plain data and is not executed, rendered as HTML or sent to an AI service by this feature.

Skip/opt-out takes effect immediately on the current device. Save pending preferences in account- and service-scoped device settings and retry them when connected. The server makes confirmed choices available across devices and reinstalls. An offline device cannot instantly update another device; the UI explains delayed synchronization. Replayed dismissal IDs do not extend the same snooze, and stale later/display requests cannot clear an opt-out or confirmed submission.

Submission failure keeps the open form and draft for explicit retry. Logout/401 clears in-memory feedback state, invalidates late responses and prevents one account's form or response from appearing in another account. Confirmed submission/opt-out cannot be erased by late status reads. Draft answers are not uploaded on skip and are not persisted as submitted feedback.

## Analysis guidance

Use `productfeedbacks` for response distributions grouped by campaign, source, app version and locale. Report each question separately, including all five score buckets and response counts. Keep manual and prompted samples separate; do not merge their averages without explaining the populations.

Use `feedbackprofiles.invitations` to distinguish reserved offers, acknowledged displays, later/never decisions and prompted submissions. For a user-level response rate, count distinct accounts with an acknowledged invitation rather than adding repeated invitations. Track users who later respond through the manual entry separately. An unacknowledged reservation is not automatically a viewed or ignored invitation. Retain missing/failed delivery information rather than assuming a zero score. No reporting dashboard is added in this delivery.

## Reproduction and acceptance

- `node --test --test-concurrency=1 tests/feedback.test.js`: eligibility/time boundaries, UTC-date deduplication, low/high scores, manual submissions, reservations/display receipts, cooldown/opt-out, maximum offers, concurrency, source context, validation, authentication/origin/body bounds and rate/error handling.
- iOS `FeedbackTests`: no default scores, text boundaries, foreground/idle gates, deferred presentation after surface changes, offline account-scoped choices/retry, no demo network calls, failed-submit recovery, 401/logout and late-account/read protection, localization and real API contract.
- `testDemoProductFeedbackAndEnglish`: both languages, unselected/required stars, later, never, voluntary reopening and demo-only submission.
- After `npm run build`: `IOS_SIMULATOR_ID=<isolated-device> IOS_DERIVED_DATA=/tmp/jobgenie-feedback-build node ios/scripts/verify-backend.mjs --feedback-only`. Uses temporary MongoDB/NextAuth/Next.js and an iPhone simulator. Seeds historical activity only in that disposable test account, waits the real two-minute threshold with no timing bypass, checks later/never, relaunch, manual low-score submission, database uniqueness and another user's isolation.

Actual results, raw logs, captures/API examples and deployment observations are linked from the delivery record in `docs/progress/`. Production user writes, signed physical devices and TestFlight distribution are separate acceptance steps.

## Verified results on 2026-11-07

- Full backend regression: 288 passed, zero failures.
- Final native core: 94 test cases, 91 passed and three environment-dependent skips, zero failures. The skipped real feedback API case passed separately against the isolated real backend; existing independent resource/document service checks were not rerun as part of this feature.
- Bilingual feedback UI and existing application create/edit/navigation/logout UI passed on the final source.
- Isolated native API and UI passed, including the actual two-minute foreground threshold, later/never, restart, manual scores of 2/5 and 4/5, optional text, a single persisted response, received state after another restart and foreign-user isolation.
- Next.js production build, final unsigned iPhone arm64 Release build, scoped ESLint, script syntax and diff checks passed.
- Initial test-fixture failures, root-list gesture interference and keyboard-dismissal issues were corrected and their failed output retained alongside passing results.

No production user feedback was written during acceptance. Unsigned compilation does not establish physical-device signing or TestFlight delivery.
