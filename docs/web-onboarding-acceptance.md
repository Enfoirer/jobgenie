# Web first-use onboarding

Implemented on 2026-11-20. The English web guide introduces application tracking, calendar reminders and application documents in three steps. Next and Back navigate between steps. The last action opens the existing Add Job page. Skip, the close button, Escape and clicking outside the dialog dismiss it and save a skipped outcome.

## Eligibility and persistence

Authenticated accounts with no applications and no terminal guide choice are eligible. Archived applications also count. Legacy accounts without guide fields are supported. Automatic presentation occurs on the Job Board while visible, with a 500 ms check that waits for other dialogs, busy interfaces and focused form controls. Form/detail routes allow users to continue their work. Existing feedback invitation checks recognize the native onboarding dialog.

`GET /api/onboarding` returns only eligibility and outcome with private no-store caching. `POST /api/onboarding` accepts exactly one completed/skipped action for the authenticated account. A single atomic update preserves the first recorded outcome and timestamp across retries and concurrent tabs. Account identity is derived from the session. Origin, method, JSON type, a 512-byte streaming body limit and 30 writes per account per minute are checked. The endpoint uses existing safe error monitoring.

The browser immediately dismisses the guide and queues an unsaved choice under an account-specific, origin-scoped local-storage key. It retries on reconnection, focus, visibility, a later dashboard mount or the visible retry action. A failed save leaves the dashboard usable. A successful write removes the local queue. Database choices suppress the guide after login or browser storage removal. Cross-tab storage updates and account refreshes close an open guide when a terminal choice is discovered. Old responses cannot reopen a dismissed guide or update a stopped account component.

Local storage can be unavailable. In that case a failed account write can suppress the guide only for the current mounted session. Another device receives a choice after its account write succeeds and its next status read. Partial step navigation is kept in memory. A reload before dismissal starts again at the first step. [Manual replay](web-guide-replay-acceptance.md) was added on 2026-11-28. Native onboarding remains future work.

## Accessibility and acceptance

The guide reuses the existing native modal, labels its title and step progress, focuses each new step heading and loops Tab/Shift+Tab between its buttons. Native Escape dismissal and focus restoration are preserved. Buttons wrap within the 390 px layout and the dialog scrolls within the viewport.

Automated API/browser-state coverage checks eligibility, archived applications, account ownership, persistent completed/skipped choices, concurrency, input bounds, rate limits, safe failures, local retry, stale replies, unavailable storage and cross-tab/device refresh. Actual isolated NextAuth/MongoDB/Chrome acceptance checks all three steps, Back, completion navigation, fresh-storage/relogin persistence, Skip, Escape, account switching, an overlapping feedback dialog, failed-save retry, keyboard focus and desktop/mobile layout. Logs and reviewed captures are linked from the JG-030 progress record. Test accounts and production-build browser acceptance use disposable local data. Production deployment and anonymous access are observed separately.
