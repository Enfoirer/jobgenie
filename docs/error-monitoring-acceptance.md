# Error monitoring and support references

Implemented on 2026-11-16. Application-owned telemetry stores a constrained diagnostic schema in MongoDB. Server API failures return a `JG-<UUID>` reference in JSON and `X-Error-Reference`. The web dashboard displays references, and the native client shows them in Chinese or English. Administrators can search `/dashboard/admin/errors` by reference, platform, exact version and inclusive UTC dates.

## Coverage and collection rules

- Existing API method exports use a shared observer. Successful responses, expected 4xx failures and framework redirect/not-found control flow retain their existing behavior. HTTP 5xx responses and uncaught route failures produce safe diagnostic records. Existing caught-error handlers provide safe error classification through request-local AsyncLocalStorage.
- Next.js `onRequestError` records server rendering failures with a numeric framework digest when available. Web recovery boundaries report render errors. Browser listeners report uncaught errors/rejections. The fetch observer consumes server references and reports unexpected API HTTP/network failures without changing successful response payloads. The reporting endpoint is excluded from fetch monitoring to prevent recursion.
- Authenticated iOS sessions report network failures and invalid response content types through the central API client. HTTP 5xx references are displayed directly. The Account tab also retains the latest reference in memory for copying. Diagnostic packets contain platform, version, category, HTTP method and a normalized route. Request bodies, queries and URLSession errors are not forwarded. Same-category native failures reuse a recent reference. Logout clears diagnostic state and late replies cannot restore it.
- Native process crash stacks, offline persisted diagnostic queues and hosting-platform termination diagnostics are outside this implementation. Native networking and response errors are covered. Client reporting requires authentication. An offline or signed-out browser may have no reference for a client-only failure.

## Safe fields

Persist only reference, platform, error category, normalized route, HTTP method/status, numeric app version, deployment commit, environment, numeric framework digest, optional known error code/source position, report count and timestamps. Source filenames must be members of the repository catalog in `lib/monitoring/locations.js`. Arbitrary exception filenames and complete stacks are discarded. Refresh that catalog when adding source files whose positions should be retained.

No raw message, stack, header, cookie, password, OAuth/API token, request/response body, email body, form input, browser user agent or full URL is accepted into this schema. Client ingestion rejects unknown fields, bounds JSON to 2 KB, validates origin and applies 30 reports/account/calendar-minute limits. Account identity contributes only to a hidden one-way grouping key for client reports. Client reports are explicitly labeled as user-submitted diagnostics in the admin interface.

Matching reports in the same UTC calendar minute share a reference and increment a report count. Adjacent minute windows can produce separate references. Counts represent accepted reports, not a guaranteed count of distinct crashes or affected users. Records expire after 30 days from first observation. MongoDB TTL cleanup is asynchronous and the viewer filters expired rows immediately.

## Failure handling and access

Diagnostic persistence has a two-second response budget. If it fails or times out, server references and allowlisted metadata go to a structured `jobgenie_error` application log with `stored=false`. The original failure status is preserved. A late database operation may still finish. Administrators should search platform logs by reference when the database viewer has no record. Database access failures can also prevent client ingestion. Diagnostic delivery is best effort.

Use the existing live database `admin` role. Both page access and API reads check it. Anonymous/ordinary users cannot inspect diagnostics. Errors in the reporting endpoint do not recursively report themselves. Administrator-account activation remains pending owner designation, as recorded in the feedback-viewer delivery. Application-managed MongoDB failure logs and API logs omit original exception objects. Hosting/framework diagnostic behavior is separate from this stored application schema.

## Acceptance

Backend and browser-state tests cover field dropping, source-file validation, stable/concurrent grouping, report throttling, packet bounds, origin/auth checks, recursion prevention, expected 4xx/redirect compatibility, persistence failure/timeout and administrator lookup/revocation. Sensitive fixtures include password, token and mail-body text. Actual browser acceptance triggers an error with those strings, verifies a visible durable reference and confirms the strings are absent from stored incidents, then queries the same reference as an administrator and checks revocation.

Native tests verify trusted reference formatting/localization, header handling, safe network packets, repeated reference reuse and logout suppression. Production Next.js and unsigned iPhone Release builds are checked. Signed-device/TestFlight acceptance remains separate. Real production failures and production account roles are not mutated for acceptance. Actual logs, screenshots and platform observations are linked from the progress record.

The Next.js integration follows the [version 15 instrumentation API](https://nextjs.org/docs/15/app/api-reference/file-conventions/instrumentation).
