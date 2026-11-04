# Account and mailbox security acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

## Mailbox OAuth

- Gmail/Outlook buttons use same-origin POST `/api/oauth/{google|outlook}/start`. Do not start when unauthenticated, cross-site or incompletely configured.
- Generate independent random state/verifier with S256 PKCE. Store only required hashes, bound to user/current session/provider for 10 minutes.
- Keep verifier in an HttpOnly, SameSite=Lax cookie. HTTPS adds Secure, `__Host-`, root path and no Domain; scripts cannot read it.
- Before exchanging code, atomically consume the valid attempt and check state, cookie, provider, user and session. Reject missing/duplicate/mismatched/expired/replayed parameters even before TTL cleanup.
- Restarting the same provider/session replaces its pending attempt. Different providers can each have one. Cancel consumes/clears the attempt; exchange failure requires restart. Invalid callbacks do not clear another valid attempt's cookie.
- Use fixed provider endpoints/callbacks, a 15-second timeout and no redirect following. Validate token/scope when supplied, mailbox address and expiry. Do not expose raw errors.
- Recheck the session after exchange, including reset revocation. Serialize mailbox writes per user to avoid duplicate links. Reconnect preserves cursors and the existing refresh token if no new one is returned.
- New login gets a random session ID; legacy sessions use stable compatibility IDs without extending expiry. Pre-deployment links without state/cookie must restart.

## Authentication rate limits

| Entry | Per IP | Per email | Fixed window |
| --- | --- | --- | --- |
| Login | 50 | 10 | 15 minutes |
| Registration | 10 | 3 | One hour |

Use MongoDB atomic counters across instances; trim/lowercase emails and hash quota keys. Consume IP quota first, then valid-email quota before lookup/password hashing. Success/failure both count; login success does not reset quota. Unknown accounts follow the same policy and fixed bcrypt comparison path.

Unix-aligned fixed windows reset at boundaries and may admit one quota on each side. Return 429 with seconds-to-reset `Retry-After`; UI shows waiting feedback. If the rate-limit database fails, fail closed with generic 503. Registration allows a 4 KB body containing only name/email/password, name up to 100 characters and password eight characters to 72 UTF-8 bytes. Return generic 409 for duplicate creation without database/hash leakage. Mailbox starts also allow 10 per user per 10 minutes.

## Deployment configuration

Use server `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `MONGODB_URI`, `GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET`, `OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET` and optional `OUTLOOK_TENANT_ID` (default `common`). Buttons no longer depend on public client-ID variables.

Provider callbacks stay `/api/oauth/google/callback` and `/api/oauth/outlook/callback` under the public base, matching provider consoles. Use `NEXTAUTH_URL` with `OAUTH_REDIRECT_BASE` fallback, require HTTPS in production and allow local loopback HTTP. Do not construct callbacks from request Host.

Only trust platform-overwritten `x-vercel-forwarded-for` on Vercel, validating IPs/normalizing IPv6; ignore spoofable generic forwarding headers. Other hosts/missing trusted IP use a shared anonymous quota until adapted. Password recovery uses the same IP reader. MongoDB replica set/Atlas remains required. `OAuthAttempt` TTL is cleanup only; expiry/single-use checks are explicit. No migration of existing mailboxes is required.

## Recorded acceptance

- `npm test`: 248 passed, including 26 new security tests. Both providers covered normal/cancelled flows, forged/missing/duplicate state, cookie mismatch, wrong user/provider/session, expiry/replay/concurrency, restart, exchange failure and session invalidation before save.
- Database/API coverage: reconnect preservation, concurrent-link deduplication, IP/email quotas, normalization, concurrency/windows, unknown users, database failure, registration limits/fields/duplicate creation.
- Production build, changed-scope ESLint and `git diff --check` passed.
- Full Chrome acceptance clicked provider buttons and checked state, PKCE, HttpOnly cookies, cancellation/cleanup/replay. Real NextAuth/registration requests triggered 429/Retry-After and visible feedback. Limited registration created no user; clearing test quotas restored login.
- Existing editing/calendar/reminders/statistics/upload/mail/recovery/session browser regressions passed.
- All used temporary databases. Browser interception and fixed token/profile responses replaced third-party exchanges. No real mailbox consent or email delivery occurred. Real provider consent/console configuration remains to be accepted with the relevant owner.

References: [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Microsoft code/PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Vercel request headers](https://vercel.com/docs/headers/request-headers).
