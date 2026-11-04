# Versioned application documents acceptance

English translation prepared on 2026-11-04 (Asia/Shanghai). Historical results and acceptance boundaries below refer to the original delivery, not a new test run. The iOS app retains Chinese/English localization.

Original delivery: 2026-11-03. Scope: web, iOS and shared backend.

## Usage

Web application details/timeline provide Application documents: choose Resume, Cover letter or Portfolio, select a library attachment, optionally label it and save a document version. The same controls are available in iOS application details. Both can upload to the library before selecting/saving a version.

Each kind has independent v1/v2 numbering, newest first, with saved time/notes. Documents do not change status/history. Web PDF preview uses PDF.js canvas; images preview directly; DOCX downloads to a local app. iOS uses Quick Look and export to Files.

## Retention and ownership

Each association saves name/type/size/label/source ID and independent byte snapshot. Deleting the source library file preserves versions/downloads. Existing versions are not overwritten. Deleting an application transactionally removes its snapshots; library files remain.

Repeated requests matching the latest source and label for that kind reuse the version. Different source/label creates another. Limit 100 versions per application; existing 4 MB/type/content rules still apply.

Validate ownership of application, source and downloads, including version-parent matching. Reject protected fields/cross-site writes. Metadata excludes bytes. Downloads retain private/no-store, nosniff, attachment and inert MIME headers; canvas previews do not execute PDF scripts.

Retained materials do not prove submission through a recruitment service/email. Demo does not access real documents; login is required.

## API

- `GET /api/jobs/:id/documents`: metadata list.
- `POST /api/jobs/:id/documents`: `{ fileId, kind: "resume" | "coverLetter" | "portfolio", label? }`.
- `GET /api/jobs/:id/documents/:documentId`: private version download.

Separate `JobDocument` snapshots use the existing per-user transaction lock to allocate versions and unique `(jobId, kind, version)` index. The library collection is unchanged.

## Acceptance and results

- `tests/jobDocuments.test.js`: independent snapshots, downloads after source deletion, per-kind versions, concurrent retry deduplication, ownership, input/content validation, authentication/origin, download headers and application-deletion cleanup.
- `node scripts/verify-job-editing-ui.mjs --documents-only`: real browser saved two versions, rendered PDF canvas, downloaded after source deletion and retained versions after refresh.
- `IOS_SIMULATOR_ID=<id> IOS_DERIVED_DATA=/tmp/jobgenie-documents-build node ios/scripts/verify-backend.mjs --documents-only`: real login/API, version linking/retry, byte checks after source deletion and native detail/preview UI.
- Full backend suite: 272 passed, zero failures.
- Three native model/API tests passed. Real API created two versions, deduplicated retry and verified downloaded bytes after source deletion.
- iPhone UI created v3, displayed v1/v2, previewed natively and logged out successfully.
- Final iOS regression: 80 passed, two independent-service tests skipped, zero failures. Real document API tests ran separately in isolated acceptance.
- Final production web build, iOS compilation and diff checks passed.

All used isolated databases/test accounts, without production writes. iOS depends on deployment of the shared APIs. Deployment observations are tracked separately in the progress evidence.
