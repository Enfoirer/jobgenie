# Sync controls and authentication acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

## Mail operations

`/dashboard/mail` offers global/per-account sync, retry, refresh and manual-review navigation. `POST /api/mail` accepts:

- `{ "action": "sync", "accountId": "optional-mailbox-id" }`: continue the saved cursor; defaults to fetching up to 10 and processing up to 50 stored messages per account.
- `{ "action": "retry", "accountId": "optional-mailbox-id" }`: claim failed stored items only. No fetch/cursor movement or successful-item reprocessing. Reuse transactions, processing leases and idempotency.

Unauthenticated/other-user/invalid action-ID-extra fields/cross-site return 401/404/400/403 respectively. Existing GET and scheduled sync remain compatible. POST does not expose message bodies or provider errors.

`/api/mail/status` reads only the current user's accounts/messages: current pending, processing, failed and manual-review counts; the last 10 failures with subject/attempts; latest per-account sync/retry result. Shared manual/scheduled logic saves `MailAccount.lastSync`; refresh and 30-second visible-page polling restore it.

Succeeded includes auto-applied, older history, manual review and irrelevant messages, not new applications alone. Queue counts are remaining backlog; result counts are per-run. Continue sync when pagination remains; retry failed items separately. A disconnected request does not imply server rollback: refresh first. Normal sync recovers expired processing leases. Never expose tokens, full messages or raw AI/provider exceptions; identify the failing stage and recovery action.

## Remember me

Unchecked sessions last a fixed 12 hours from login; checked sessions last a fixed 30 days. Both login and post-registration login submit the choice. Refresh, session reads and client-session updates do not extend expiry.

Encrypted JWT expiry matches the session. The cookie container lasts at most 30 days and cannot revive an expired payload. This does not promise logout when the browser closes. Existing sessions keep original JWT expiry. Changed `authVersion`, deleted users and absolute expiry revoke protected access.

## Password recovery

`/forgot-password` requests recovery; `/reset-password#token=…` sets a password of at least eight characters and at most 72 UTF-8 bytes. New registrations use the same rule; existing short passwords can still log in.

- Use a 256-bit secret; store only SHA-256. Fragment tokens do not enter server request URLs and are cleared on success. Reset pages are no-index/no-referrer.
- Single-use, 30-minute expiry. A new request replaces the old link. Atomic concurrent consumption allows one success; viewing/previews do not consume it.
- Increment `authVersion`, revoke old sessions and require login with the new password.
- Return the same generic response for existing/nonexistent accounts. Normalize addresses. Limit requests to one per minute/five per hour per address. MongoDB atomic per-IP/action quotas allow 20 per hour with TTL cleanup.
- Vercel uses trusted `x-vercel-forwarded-for`; other deployments use a shared conservative anonymous bucket until trusted-proxy integration exists. Fixed windows can admit adjacent boundary bursts; existing users also have an exact 60-second sending cooldown.
- Provider failure removes the undelivered token hash, logs no address/token and returns the generic response. API acceptance is not proof of delivery.

## Production configuration

Use the [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) with no new runtime dependency. Server variables: `NEXTAUTH_URL` (public HTTPS site), `RESEND_API_KEY` (server-only key), `PASSWORD_RESET_FROM` (verified domain sender, such as `JobGenie <accounts@example.com>`). Never use `NEXT_PUBLIC_` for sending secrets or commit them. Redeploy after configuration.

Missing configuration returns 503 with unavailable feedback rather than claiming delivery. Real delivery still requires an owner-controlled registered address. Automation sent no real email.

## Acceptance coverage

- `npm test`: retries without fetch/duplicate effects, failed-batch continuation, ownership/sensitive-data hiding, token expiry/tampering/replay/concurrency, limits, sender failure, password bounds, fixed sessions and revocation, plus regressions.
- `npm run build` passed. At the recorded run local Next was 15.3.1; committed manifests pinned 15.5.28 for deployment.
- `npm run test:ui`: real Chrome, temporary MongoDB and local production Next verified editing/schedules/reminders/statistics, mail outcomes/persistence/errors/unauthorized retry, normal/remembered login, expiry, recovery entry/unavailable feedback, password change and session revocation.
- Expired local fake mailbox tokens failed before external retrieval; an injected sender tested the real password-change flow. Production data was not accessed.
