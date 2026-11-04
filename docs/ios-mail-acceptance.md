# iOS mail controls and authorization acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

Immediate sync, failed-item retry, results, manual review and Gmail/Outlook native authorization reuse web mail-processing and application-history rules.

## Behavior

- Sync/retry each mailbox from Mail. Show fetched, succeeded, failed, manual-review and error counts plus recent failed mail. Unavailable queue counts are unknown, not zero.
- Partial failure preserves confirmed results and identifies fetching versus processing. Refresh failure keeps the last result. A remaining pagination cursor prompts continuation.
- Succeeded includes unrelated/skipped and manual-review mail, not just new applications. Reuse `/api/mail` and `/api/mail/status`.
- Manual review shows provenance/plain text, company, role, event, target and interview/deadline times. Explicitly choose an existing/new application; reselect unknown events. `/api/pending/:id` preserves older mail as history without overriding newer status. Ignoring requires confirmation.
- After review, refresh applications/details/schedules/mail queues. Failure preserves pending items/drafts. A 401 clears user data; late responses cannot restore data after logout.
- Demo supports these flows without real mail. UI supports both languages.

## Native authorization protocol

1. Generate a random verifier and S256 challenge; POST `/api/oauth/{google,outlook}/native/start` with the signed-in site session.
2. Server stores a 10-minute attempt bound to user, session hash, provider and challenge. Return random state/provider URL. Limit starts to 10 per user per 10 minutes.
3. App validates provider host, HTTPS, state and challenge, then opens an ephemeral `ASWebAuthenticationSession`.
4. Provider returns to the existing `/api/oauth/{google,outlook}/callback`. A separate native handler receives the code once and responds 303 to `com.enfoirer.jobgenie://oauth/mail?state=...`. This browser callback does not bind the mailbox. No code, token or site cookie enters the App callback URL.
5. App validates scheme/host/path/unique state, then POSTs the original verifier to `native/finish`. Server checks user/session/challenge/provider/expiry and atomically consumes the attempt. After token exchange, recheck the session before saving.
6. `native/cancel` removes a cancelled attempt before completion. If finish was submitted and its outcome is unknown, refresh the mailbox list rather than claiming nothing was linked. Leaving the page cancels system authorization; logout prevents completion for another session.

Reuse server Client IDs/secrets and HTTPS callbacks; no secret belongs in the app and no custom scheme needs provider registration as a redirect URI. The new App linking flow requires six deployed POST routes. Scheme changes require coordinated client/server/test updates.

## Results on 2026-10-24

Isolated iPhone 17/16e simulators on iOS 26 were used.

| Check | Result |
| --- | --- |
| Full server suite | 258 passed, including 10 native-authorization tests |
| iOS core | 43 passed, including 12 mail/model/sync/review/authorization tests |
| Demo/language UI | Five distinct tests passed across runs, including mail review/ignore and history/schedule regressions |
| Isolated real-backend UI | Three passed: history, web interoperability and complete mail controls, with database assertions |
| Builds/static checks | Web production, Debug, unsigned iPhone arm64 Release, changed-JS ESLint and project/plist checks passed |

51 distinct iOS tests passed. Previously passed history/application regressions were retained across an interrupted run; remaining UI, core and mail checks were rerun. Post-finish cancellation messaging has a dedicated passing test. [Manual review screenshot](../ios/docs/iphone-mail-review.png).

Integration used temporary MongoDB/users/Next.js. Fixtures had no real refresh tokens; simulated fetch failure ended locally. Retry processed stored mail into Strict review. Assertions covered increased attempts, exactly one accepted history entry, ignored items leaving the queue, relaunch persistence and mailbox isolation.

Mock provider exchanges covered both providers, PKCE, wrong sessions/users/verifiers, expiry, duplicate/concurrent finish, denial, cancellation, limits and session invalidation during exchange. Injected browser closures tested iOS coordination; production always uses system authorization, with no test-link bypass.

Rerun instructions: [iOS README](../ios/README.md). `CODE_SIGNING_ALLOWED=NO` proves compilation only. Real-provider login/consent/denial/return/reauthorization/mail retrieval, physical devices, signing, TestFlight and APNs remain unverified. The account owner must complete real consent after deployment.

References: [Apple ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/), [OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html).
