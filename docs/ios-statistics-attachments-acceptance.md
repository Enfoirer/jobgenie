# iOS statistics and attachments acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

Open Profile, Data and files, then Analytics or Attachments. Both UI languages are supported.

## Statistics

Use shared `/api/stats`, never infer historical stages from current status. Current distribution covers all account applications regardless of selected dates. Conversion uses applications submitted within the range and eligible history within that range up to now. Interview-to-offer requires an interview first. Show numerator/denominator/rate; no denominator displays an em dash.

Default to the last 30 calendar days, with custom ranges up to 366 days. Send Gregorian dates and the phone's IANA timezone. Server uses inclusive start/exclusive next-day midnight, including DST. Display returned dates/timezone/update time. Clear stale results during new queries; offer retry on failure. Refresh on entry/foreground/pull-to-refresh. Demo calculates only its own history.

## Attachments

This milestone used the shared account-level library, without application binding (later delivered by JG-022).

- Pick one PDF/DOCX/PNG/JPG/JPEG, maximum 4 MB. Validate client name/extension/read bounds; server validates content. Multipart includes only `file`.
- Authenticated download to a temporary directory opens native Quick Look, not an embedded webpage. Export rechecks ownership and uses the system destination picker.
- Ignore response `filePath`/URLs. Construct addresses from the fixed service base and validated ID. Reject HTML/JSON success responses or binaries over 4 MB.
- Unsupported legacy type/name disables preview; export as `attachment.bin`. Do not download legacy files over 4 MB.
- Add confirmed uploads immediately, then read the same server library on refresh. No automatic upload retry after an uncertain result.
- Random preview subdirectories use complete file protection and are cleaned on leaving/logout/next initialization. User-exported Files copies remain user-managed.
- Logout invalidates requests and clears statistics, lists and demo attachments. Server checks ownership; no sessions are cached in download links.

## Results on 2026-10-26

Statistics/API, web consistency and system file flows passed. An App-uploaded PDF appeared on web with identical bytes. Native preview, Files export and picker reupload passed; database bytes matched for both files. Relaunch persistence and unauthenticated/other-user denial passed.

65 core tests passed across runs; real-backend API acceptance ran separately. New bilingual demo and real-backend UI passed. 42 server statistics/attachment regressions, Debug and unsigned iPhone arm64 Release passed. Six existing application/history/schedule/mail/reminder/language UI regressions passed.

74 distinct iOS tests passed: 65 core, one real-backend API, seven demo/language UI and one real-backend UI. Reruns are not counted twice. Temporary MongoDB/local Next.js were used; production files were not read. Screenshots: [analytics](../ios/docs/iphone-analytics.png), [attachments](../ios/docs/iphone-attachments.png).

After the local build described in [iOS README](../ios/README.md), run `IOS_SIMULATOR_ID='<isolated-simulator-uuid>' node ios/scripts/verify-backend.mjs --resources-only`.

File selection/preview/export use [Apple SwiftUI presentation APIs](https://developer.apple.com/documentation/SwiftUI/View-Presentation). Physical devices and third-party providers such as iCloud/enterprise storage still require device acceptance.
