# Historical development evidence

Prepared: 2026-11-04. Translated into English: 2026-11-04 (Asia/Shanghai). The 22 earlier development/design milestones retain their original task IDs and historical facts. The same original workbook is now translated and renamed in place.

Local Git reflog records the clone at 2026-10-17T15:04:59+08:00 and the first development commit at 15:33:57 that day. October 15/16 remains an unverified recollection. Earlier repository history is not claimed as work in this collaboration.

Each record covers requirements/decisions, tests/builds, visuals/API examples and deployment observations. Missing evidence is explicit. Historical summaries do not replace original logs. Git dates, file mtimes and hashes are not trusted third-party timestamps. Cumulative test counts must not be added together.

| Milestone date | Record | Sanitized original logs | Historical visual | Observed deployment check |
| --- | --- | --- | --- | --- |
| 2026-10-17 | [JG-015 Mail: durable storage and retry](records/2026-10-17-JG-015.md) | Not located | Not located | failure |
| 2026-10-17 | [JG-016 Mail: pagination and shared sync](records/2026-10-17-JG-016.md) | Not located | Not located | failure |
| 2026-10-17 | [JG-017 Web: Vercel deployment fix](records/2026-10-17-JG-017.md) | Not located | Not located | success |
| 2026-10-17 | [JG-018 Mail: AI extraction and matching](records/2026-10-17-JG-018.md) | Not located | Not located | success |
| 2026-10-18 | [JG-001 Web: application and history editing](records/2026-10-18-JG-001.md) | Not located | Not located | success |
| 2026-10-18 | [JG-002 Web: calendar and tasks](records/2026-10-18-JG-002.md) | Not located | Not located | success |
| 2026-10-18 | [JG-003 Web: in-app reminders](records/2026-10-18-JG-003.md) | Not located | Not located | success |
| 2026-10-18 | [JG-004 Web: statistics and analytics](records/2026-10-18-JG-004.md) | Not located | Not located | success |
| 2026-10-18 | [JG-005 Web: sync controls and authentication](records/2026-10-18-JG-005.md) | Not located | Not located | success |
| 2026-10-18 | [JG-006 Web: upload security](records/2026-10-18-JG-006.md) | Not located | Not located | success |
| 2026-10-18 | [JG-007 Web: account and mailbox security](records/2026-10-18-JG-007.md) | Not located | Not located | success |
| 2026-10-19 | [JG-008 iOS: foundation and applications](records/2026-10-19-JG-008.md) | Not located | Not located | success |
| 2026-10-19 | [JG-009 iOS: Chinese and English switching](records/2026-10-19-JG-009.md) | Not located | Not located | success |
| 2026-10-19 | [JG-010 iOS: application status and history](records/2026-10-19-JG-010.md) | Not located | Not located | success |
| 2026-10-19 | [JG-011 iOS: schedule editing and navigation](records/2026-10-19-JG-011.md) | Not located | Not located | success |
| 2026-10-24 | [JG-012 iOS: mail controls and authorization](records/2026-10-24-JG-012.md) | Not located | Not located | success |
| 2026-10-25 | [JG-013 iOS: in-app reminders](records/2026-10-25-JG-013.md) | Not located | Not located | success |
| 2026-10-26 | [JG-014 iOS: statistics and attachments](records/2026-10-26-JG-014.md) | Not located | Not located | success |
| 2026-10-29 | [JG-019 Design: English iPhone prototype archive](records/2026-10-29-JG-019.md) | Not located | Not located | success |
| 2026-10-30 | [JG-020 Web and iOS: bulk actions](records/2026-10-30-JG-020.md) | Not located | Not located | success |
| 2026-11-01 | [JG-021 iOS: Safari job sharing](records/2026-11-01-JG-021.md) | 6 logs | Available | Unknown |
| 2026-11-03 | [JG-022 Web and iOS: versioned application documents](records/2026-11-03-JG-022.md) | 7 logs | Not located | Unknown |

## Collected artifacts

The original collection contains 14 sanitized logs and four reviewed images. [The machine-readable index](evidence-index.json) records original/public hashes, collection times and provenance. Untouched originals remain private. Public logs redact local paths and possible credential assignments; original-language test output remains unchanged. Personal, school and financial files are excluded.

The [anonymous login capture](visuals/2026-11-04/live-login.png) is a current observation, not an earlier-version screenshot. The [root loading-state capture](visuals/2026-11-04/root-loading-observation.png) is not proof of complete page acceptance.

The [deployment responses](deployments/2026-11-04-observed-statuses.json) retain early failures, later successes and missing checks. JG-017 success does not overwrite JG-015/JG-016 failures. JG-022 code was included in the later successful deployment of `aea1914`; its own original commit returned no independent check.

## Evidence maintenance deliveries

[JG-023 Historical evidence and delivery workflow](records/2026-11-04-JG-023.md) records the organization work and current testing/capture on 2026-11-04. This brought the workbook to 23 milestones. The [current document-versions capture](visuals/2026-11-04/application-document-versions.png) and [browser log](tests/2026-11-04/jobgenie-recording-2026-11-04.log) are dated November 4 and are not historical originals.

[JG-024 English development records](records/2026-11-04-JG-024.md) translates the existing records and original workbook, retains the bilingual iOS product and adds the current validation/previews. The workbook now contains 24 milestones.

[JG-025 iOS product feedback](records/2026-11-07-JG-025.md) was completed on 2026-11-07, with current acceptance evidence. The original workbook now contains 25 milestones.

[JG-026 Web product feedback](records/2026-11-08-JG-026.md) was completed on 2026-11-08. The original workbook now contains 26 milestones.

[JG-027 iOS APNs implementation and local acceptance](records/2026-11-12-JG-027.md) was completed on 2026-11-12 for code and local tests. The original workbook now contains 27 scoped milestones. Apple enrollment, APNs credentials, scheduler setup, signed-device delivery and TestFlight remain outstanding.

[JG-028 Administrator feedback review](records/2026-11-13-JG-028.md) adds the English, administrator-only feedback page on 2026-11-13. The original workbook now contains 28 scoped milestones. Production administrator designation remains pending.
