# iOS system push notifications

Implementation and local acceptance: 2026-11-12 (Asia/Shanghai).

This extends the existing in-app reminders with opt-in APNs alert delivery. It does not require the iPhone app to keep running. Real Apple delivery, signed-device behavior and TestFlight remain unaccepted: the owner has not yet enrolled in Apple Developer or configured APNs. Missing configuration is shown explicitly in the app. Demo mode never registers devices or requests notification permission.

## Requirements and behavior

- Reminder settings contains a separate per-device system-notification control. Permission is requested only after an explicit tap and a ready server configuration. In-app reminder preferences and lead time remain shared with the web. A device opt-in does not override the account reminder switch.
- The worker projects the existing live schedule, settings, reminder revision and read/snooze/cancel state. Default lead time is one hour, with 15/30/60/1440-minute choices. Missing or expired times, archived/deleted applications, deleted history and Offer/Rejected applications cannot send alerts.
- Read/cancel suppress delivery. An explicit snooze permits one delivery after its saved ten-minute delay, subject to the event still being future and active. Normal refresh, preference changes, token refresh and same-installation relogin do not create repeat alerts for an already-attempted occurrence. A schedule change creates a new revision, including A to B to A.
- Notification text is generic, English or Chinese, and includes no company, role, notes, email, mailbox credential or session cookie. The alert carries opaque delivery/binding identifiers and a reminder reference. No badge is sent, avoiding stale account-specific counts on the app icon.
- A foreground banner and a notification tap require server validation of the current account, device binding, session and live reminder. Valid taps open application details. Cold-launch taps wait for account restoration. Stale, foreign-account and unverifiable notifications do not open private records.

## Device and logout security

The Keychain stores a random 256-bit installation capability and monotonically increasing sequence numbers. The server stores only the capability hash. Registration requires an authenticated session, same-origin JSON, bounded input and rate limiting. Device tokens are server-only fields and are never returned in API responses or written to logs. The same token cannot remain active on two installations/accounts.

Each binding records the authenticated session identity, absolute expiry and auth version. Password reset, deleted users and session expiry stop delivery. Each account can have at most ten active, unexpired installations. The installation capability authorizes only its own registration ordering and unauthenticated **revocation**, never reading data or registering a device without an authenticated account.

Logout first unregisters APNs locally and clears local/delivered notifications, navigation and binding state. It saves a revocation tombstone before network work. A separate cookie-free client submits revocation even after session cookies are removed. Offline failure remains in Keychain and retries on foreground/relaunch, including the signed-out screen. A higher sequence blocks delayed pre-logout registration. An older queued revoke cannot remove a newer account binding. A new account must explicitly enable notifications again.

If secure storage fails, the app reports that server unlinking has not been saved. It does not claim that remote revocation succeeded. No client can instantly update a server while offline. Local unregistration, generic alert content and server-side tap authorization limit this gap.

## Queue, concurrency and failure rules

`POST` or `GET /api/push/cron` requires an exact `Authorization: Bearer <CRON_SECRET>` header and a secret of at least 32 characters. Missing configuration returns 503 before claiming deliveries. A persistent worker lease prevents overlapping scans; a saved device cursor and bounded sending budget allow later runs to continue.

MongoDB transactions serialize delivery reservations with the existing per-user schedule mutations. A unique delivery ID includes installation, account, occurrence revision and explicit snooze phase. The worker revalidates before and after APNs IO. Unique active-token and delivery indexes are initialized before accepting mutations. A MongoDB replica set/Atlas is required.

APNs requests use HTTP/2, ES256 `.p8` authentication, the configured bundle topic, the device's sandbox/production environment, alert push type, priority 10 and a stable collapse ID. Provider JWTs are reused for up to 50 minutes. Expiration is zero: APNs must not retain alerts for later offline delivery. APNs acceptance is not proof that the user saw a notification.

Only explicit APNs 429/500/503 rejections retry, with one/two-minute backoff and at most three attempts, always checking current state again. Rejected invalid tokens disable only the exact binding that used them. Timeouts, transport errors and abandoned sending claims have an **unknown** outcome and are not replayed. This deliberately favors avoiding duplicate alerts over guaranteed delivery after an ambiguous failure. The persistent in-app reminder remains available.

## Limits on invalidation

Changes/deletion invalidate unsent reminders and server-authorized navigation immediately when observed. The app removes obsolete delivered alerts when its live reminders refresh in the foreground, and clears all on logout. A notification already accepted by APNs cannot be guaranteed to disappear from an offline device's Notification Center after a remote schedule edit. A mutation may also commit in the narrow interval between the final DB check and Apple's acceptance. Generic content, zero offline expiration, post-send checks and tap validation protect this boundary. No instantaneous remote withdrawal or exactly-once receipt is promised.

## Server setup for later real-device acceptance

Set server-only variables in the deployment environment, then redeploy:

| Variable | Value |
| --- | --- |
| `PUSH_ENABLED` | `true` only when ready for actual Apple delivery |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `APNS_KEY_ID` | APNs signing key ID |
| `APNS_PRIVATE_KEY` | Full P-256 `.p8` PEM, with real newlines or escaped `\n` |
| `APNS_TOPIC` | The signed main app's bundle ID, initially `com.enfoirer.jobgenie` |
| `APNS_ALLOW_SANDBOX` | `true` for development-device testing, otherwise omitted/false |
| `CRON_SECRET` | At least 32 cryptographically random characters |
| `NEXTAUTH_URL` | Public HTTPS deployment origin |

Keep keys out of chat, Git and screenshots. Runtime feature flags default to disabled. The sharing extension does not register for APNs.

Enable Push Notifications for the main App ID, select the developer Team, regenerate provisioning profiles, and retain the existing main-app/Share App Group. The project generator sets `aps-environment` to development for Debug and production for Release. TestFlight uses the production APNs endpoint. If the bundle ID changes, update `APNS_TOPIC` as well.

Use an authorized external scheduler to invoke `/api/push/cron` every minute with the bearer header, or run `npm run push:worker` under a supervised process. `npm run push:worker -- --once` invokes one tick. No scheduler or background process is silently provisioned by this change. Worker responses contain aggregate counts only. Monitor failures and tick cadence; delivery precision depends on worker cadence/capacity as well as Apple's delivery behavior. Vercel Hobby's once-per-day cron limit is unsuitable for these reminders; use a supported plan or an external scheduler. No minute-level `vercel.json` cron is added that could break a Hobby deployment.

## Local checks

- `node --test --test-concurrency=1 tests/push.test.js`: disposable MongoDB replica set, synthetic accounts, generated ephemeral P-256 key, injected sender and a real loopback HTTP/2 APNs simulator. Covers authentication, ownership, logout/rebinding ordering, uniqueness, concurrency, snooze, revisions, removal/terminal states, expiry, safe retries, invalid tokens, cursor/budget continuation and transport headers/signatures. It does not contact Apple.
- iOS `PushTests`: mocked system authorization/APNs registration and isolated URL protocols. Covers explicit permission, demo/configuration gating, denied permission, token/language updates, Keychain relaunch, offline logout retry, account switching, cold tap restoration, stale replies, validation and cleanup.
- Simulator UI: bilingual settings/demo disclosure plus existing read/snooze/cancel/settings flows. Demo mode requests no actual notification permission. Screenshots show synthetic data.
- Full backend regression, scoped ESLint, production Next.js build, native unit tests, simulator UI and unsigned arm64 Release compilation are recorded separately in the progress delivery record. Environment-dependent historical native tests remain explicitly skipped in the unit-only run.

## Physical-device acceptance still required

1. Install a properly signed Debug build and confirm system permission is requested only after opting in. Test allow/deny and settings changes. Register against sandbox-enabled server configuration.
2. Run the secured worker. Verify a real alert with the app backgrounded and closed, and distinguish APNs acceptance from display. Test network loss and Focus settings.
3. Repeat worker ticks, token registration and relaunch; verify no repeated initial alert. Snooze deliberately and verify one alert for that snooze.
4. Reschedule, clear, delete, archive, mark read/cancel and disable before dispatch. Verify unsent alerts stop and stale taps cannot open records. Check the documented already-delivered Notification Center limitation.
5. Sign out online/offline, then sign in as another account. Confirm local clearing, eventual remote revocation, old-response rejection and no private-content exposure. Verify password reset/session expiry stops old bindings.
6. Install a Release/TestFlight build and repeat with production APNs, matching topic/entitlement and App Group provisioning.

## References

- [Apple: sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
- [Apple: registering your app with APNs](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)
- [Vercel: cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
