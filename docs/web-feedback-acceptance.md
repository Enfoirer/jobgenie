# Web product feedback

Delivery date: 2026-11-08 (Asia/Shanghai). Scope: English dashboard UI, browser invitation state and the existing authenticated feedback API. The [iOS survey](ios-feedback-acceptance.md) remains bilingual.

## Questions and entry

The dashboard header's Feedback star opens Rate JobGenie from any dashboard page. The form asks overall satisfaction and likelihood of recommending JobGenie to a friend, each with one to five stars and explicit endpoints. Neither is selected initially. Both scores are required to submit. Suggestions are optional plain text, limited to 2,000 UTF-16 code units. Low and high scores use exactly the same submission path.

Not now, Escape, the close button and the backdrop dismiss without sending draft answers and defer automatic invitations for at least 14 days. Never show automatically again permanently disables automatic invitations for the account. The voluntary entry stays available. A confirmed response opens as a read-only receipt on either platform. The form identifies account/platform/version/language context, invitation/skip recording and asks users to avoid sensitive content. No App Store or external review routing is added.

The native dialog contains focus and restores it on close. Stars are native radio groups with keyboard controls, visible focus and 44-pixel targets. The form scrolls within the viewport on small screens. Failed saves retain the open form, scores and comment for explicit retry. Browser storage contains only account-scoped suppression/submission markers and reservation IDs, never draft scores or comments.

## Automatic invitation policy

Use the existing campaign `ios-product-v1` to preserve native compatibility and one shared response per account. Eligibility requires seven elapsed days from the first server-observed feedback visit and three distinct UTC active dates in the last 30 dates. Observations from either platform contribute. No earlier usage is inferred or backfilled.

The browser additionally requires two accumulated foreground minutes during the current signed-in provider session and 30 seconds without interaction. Hidden/unfocused time does not accumulate, and long suspended timer gaps are capped. Only the root Job Board, Calendar & To-do, Mail and Analytics pages allow automatic presentation. Editors, modal dialogs, selected bulk items, input focus, dragging/pointers and marked save/delete operations defer it. Activity and safe-surface conditions are rechecked after network waits. A newly mounted session starts its foreground timer again.

Every eligible account follows the same rule regardless of application status, success, sentiment or likely score. At most two automatic offers are reserved per account/campaign. Each reservation starts a 14-day minimum interval. The browser shows at most one automatic dialog in its tab session. A display acknowledgment is sent only after the dialog opens. A reserved but unshown offer is not treated as an exposure. Transient network failures during automatic checks remain silent.

This samples experienced active users. Nonresponse and voluntary-entry bias remain. Report both questions separately and distinguish manual responses from prompted responses. Five-star recommendation is not NPS. Count acknowledged displays separately from reserved offers; retain missing delivery information rather than treating it as a negative score. No analysis dashboard or automated text analysis is added.

## Shared persistence and compatibility

The existing `GET/POST /api/feedback` retains session-derived ownership, private/no-store reads, same-origin writes, strict field validation, 12-KiB streamed body limits, per-account throttling and per-user transactions. A unique account/campaign key keeps one immutable answer even if web and native submit concurrently or retry.

Web requests declare `platform: web`; new invitation/response records accept only `web` or `ios`. Omitted platform defaults to `ios` for existing native clients and old responses. Platform is client-supplied analysis context, not proof of the device that sent a request. Existing native campaign validation and response fields remain compatible.

Not now and Never take effect immediately in the browser, with pending account-scoped preferences retried using the same request ID on reconnect/active checks. If storage is unavailable, the notice explains that local persistence could not be saved. Confirmed choices become visible to other clients at their next server check, not through a live push. Offline devices cannot synchronize instantly. A manual Not now also defers another device's unshown reservation without claiming a display. Later cannot undo Never or a confirmed submission.

Account changes unmount the provider, abort pending requests, discard the draft and ignore late results. Late status reads cannot erase a confirmed submission/opt-out. Cross-tab storage changes apply local suppression. Unauthorized API responses clear feedback state and return to login. Survey responses are rendered as text and are neither inserted as HTML nor sent to an AI service.

## Reproduction

- `npm test`: backend regression, cross-platform compatibility/concurrency and browser state tests. Browser tests use fake clocks/transports to cover timing boundaries, unsafe surfaces, offline choices, retries, storage failures, late reads, unmount/401 and malformed data.
- Scoped ESLint with explicit `.js,.jsx` extensions and `node --check scripts/verify-feedback-ui.mjs`.
- `npm run build`: production Next.js build with local placeholder configuration.
- After the build, `PROGRESS_CAPTURE_DIR=/tmp/jobgenie-web-feedback-captures node scripts/verify-job-editing-ui.mjs --feedback-only`: real credential login, temporary MongoDB replica set/Next.js, fresh isolated headless Chrome. Historical eligibility is seeded only in temporary test accounts. The test waits the actual two-minute foreground threshold while an existing editor is open, then the real safe-idle delay. It checks empty scores, shown receipt, shared snooze, failed-submit recovery, one low-score response, legacy native retries, reload, desktop/mobile layout and focus, account switching, offline Never/reconnect, native responses on web and signed-out rejection. There is no product timing bypass.

Actual results, sanitized logs, reviewed captures/API examples and the exact deployment observation are linked from [JG-026](progress/records/2026-11-08-JG-026.md). Local browser/API acceptance does not establish production authenticated business writes or physical-device/TestFlight delivery.

## Verified results on 2026-11-08

- Full automated regression: 304 passed, zero failures or skips, including 20 feedback backend and 12 browser-state tests.
- Real browser/API acceptance passed all the flows above, including the actual foreground/idle delay, a failed save followed by one persisted 1/5 and 2/5 response, native retry protection, offline opt-out synchronization and account isolation.
- Final production build, scoped ESLint including JSX, script syntax and diff checks passed. A React ref cleanup lint warning was corrected before final verification.
- Desktop and 390-pixel mobile captures were visually reviewed. The retained screenshots intentionally show the simulated error and retained answers. Mobile dialog content scrolls to the submit/skip controls.
- Native source/binaries were not changed or rebuilt. Legacy native API compatibility was tested directly; the November 7 native build/UI results remain separate historical evidence.
