# iOS job sharing acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

Original delivery: 2026-11-01.

## Usage

1. Open a job in Safari, tap Share and choose JobGenie. Enable it under More if needed.
2. Prefill the HTTP/HTTPS URL. Optionally enter company/role in the share panel or later.
3. Save the draft, then open JobGenie.
4. Sign in and open Applications, Shared jobs, then complete/create. Confirm account, company, role and URL before saving.
5. Success removes the draft and creates the application through existing APIs. Web refresh shows it with initial `applied` status.

The extension neither force-launches the main app nor reads credentials/writes to an account. Drafts persist offline/across relaunch in the device App Group. Demo can view but not import drafts. Signed-out users save first and explicitly confirm ownership after login.

## Data and boundaries

Accept one web URL or text containing one unambiguous web link. Reject files, JavaScript, credential-bearing URLs and multiple distinct links. Do not scrape the page or guess company/role from its title; both are required before creation.

Identical URL/company/role reuses a pending draft; limit 50 drafts. Warn about existing applications with the same link, allowing a deliberate separate application. Atomically write one file per draft; validate size/content/ID on read so corrupt files do not lose valid drafts.

Cancel/failure keeps drafts. Cleanup failure after confirmed creation prompts manual removal. Drafts contain no tokens/account data and never auto-submit after account switching. An uncertain create response requires checking refreshed applications before retrying to avoid duplicates.

## Project and signing

Embedded extension: `JobGenieShare`, bundle ID `com.enfoirer.jobgenie.JobGenieShare`. Main app/extension both use `group.com.enfoirer.jobgenie`. Register the Group, enable it for both App IDs, select the same Team and update profiles before signed-device/TestFlight distribution. Missing Group yields an error rather than false success.

`ios/scripts/generate-project.py` preserves the extension target, shared source/resources, dependencies, embedding and entitlements.

## Verification and results

`ShareTests` covers URL/text validation, persistence/reopen, deduplication/deletion, capacity/corruption and the real shared container. Run `IOS_SIMULATOR_ID=<device> IOS_DERIVED_DATA=/tmp/jobgenie-share-build node ios/scripts/verify-backend.mjs --share-only` for Safari, extension, container, login, prefilled creation, relaunch and isolated database checks.

- 78 unit tests passed; one existing real-resource-service test skipped under its environment conditions. All five new sharing tests passed.
- Safari end-to-end acceptance passed with iPhone 17, real NextAuth/Next.js and isolated MongoDB: extension display, URL/company/role, draft removal, relaunch persistence and logout.
- Database: exactly one new application/initial history for the test user, matching URL/company/role; another user's data unchanged.
- Unsigned iPhone Release (`CODE_SIGNING_ALLOWED=NO`), reproducible project generation and `git diff --check` passed.

No web backend change in this feature. Developer signing and TestFlight remain outstanding.
