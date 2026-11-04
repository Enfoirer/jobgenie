# Upload and download security acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

## Upload rules

Accept one PDF, DOCX, PNG or JPG/JPEG per request, up to 4 MiB (displayed as 4 MB). Reject old DOC, DOCM, HTML, SVG, scripts and generic ZIP. Users can convert DOC to PDF/DOCX; existing files are not deleted.

Client/server share extension, filename, size and declared MIME checks. Server also validates PDF header/end markers, PNG header/IHDR/end and JPEG start/end. Empty MIME or `application/octet-stream` still requires content validation; specific MIME/extension conflicts fail.

Pinned yauzl 3.4.0 checks DOCX ZIP structure and required Word parts/content types. Reject macros, ActiveX, embedded objects, encryption, duplicate/invalid paths and symlinks. Read streams without extracting to disk. Limits: 512 entries, 16 MiB each, 32 MiB total decompressed, required XML up to 8 MiB. Do not parse DTD/external entities.

These are format/container checks, not complete document parsing, antivirus or content sanitization. Valid signatures cannot identify all malicious documents. Downloads remain attachments rather than executing uploaded content under the application origin.

Authenticate and check origin before reading the body. Enforce both Content-Length precheck and actual streamed bytes. Body limit is 4 MiB plus 64 KiB multipart overhead. Missing/false length cannot bypass it. Require exactly one `file` field; reject text/additional fields, duplicate/empty files and invalid names.

The limit reserves multipart overhead below [Vercel's 4.5 MB request/response limit](https://vercel.com/docs/functions/limitations#request-body-size). The old 10 MB UI was corrected. Legacy large downloads remain platform-limited; object-storage migration was outside scope.

## Storage and downloads

- Reuse the MongoDB `files` collection and shared File model instead of three duplicate schemas. Exclude body by default; explicitly select it for downloads. List responses exclude body and user ID.
- Scope list/download/delete to the current user. Other-user, malformed and nonexistent IDs return 404; unauthenticated returns 401. Await asynchronous Next.js route params; atomically delete with ownership conditions.
- All files, including legacy HTML/SVG/DOC, use `Content-Type: application/octet-stream` and `Content-Disposition: attachment` regardless of stored MIME.
- Headers: `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`.
- ASCII fallback plus UTF-8 `filename*` preserves international filenames. Exclude paths, controls, bidi characters and reserved symbols from headers.
- Do not return raw provider/database errors. Remove email-address, filename and file-list debug logs.

## UI and acceptance

The picker declares supported types and single selection. Multi-file drops show an error. Rejection reasons are visible and the same file can be selected again. Replace content previews with Details, Download and Delete. The shared accessible metadata dialog loads no iframe/object/embed/image content. Provide refresh and load-failure retry.

- `npm test`: all 222 passed, including 20 new upload checks for signatures, MIME conflict, disguised extensions, empty/oversized files, names, ZIP bounds/macros/encryption/paths, multipart, authentication ordering, ownership, headers, international filenames and safe legacy downloads.
- `npm run build` and relevant ESLint passed. At that run local dependencies were Next 15.3.1; the production lockfile pinned 15.5.28 for Vercel.
- `npm run test:ui`: temporary MongoDB/isolated Chrome verified actual PDF/DOCX uploads, disguised HTML rejection, size feedback, metadata dialog, refresh persistence, international downloads, legacy HTML download without execution, ownership/deletion and 390px layout. Editing/schedule/reminder/statistics/auth regressions also passed.
- Browser downloads were temporary and cleaned afterward. No production user files were read/modified.

References: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [yauzl documentation](https://github.com/thejoshwolfe/yauzl).
