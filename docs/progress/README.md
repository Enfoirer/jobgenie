# Project progress and development evidence

Updated: 2026-11-04 (Asia/Shanghai).

[Project progress and Gantt chart](project-progress.xlsx) is the single maintained workbook, with **Progress Gantt** and **Update Log** sheets. This is the original workbook translated and renamed in place, not a second tracker. Task IDs, historical dates, results and source references are retained. The language conversion is recorded separately. The iOS app continues to support Chinese and English.

After every delivery, update the workbook and four evidence categories, create an English Git commit, push it to GitHub and verify the remote SHA. Follow the [recording guidelines](recording-guidelines.md) and [delivery template](templates/delivery-record.md).

## Directory structure

```text
docs/progress/
  project-progress.xlsx       Original, single maintained workbook
  README.md                   Current overview
  historical-records.md        Milestone index and provenance
  recording-guidelines.md     Required delivery workflow
  evidence-index.json         Task links, sources and artifact hashes
  records/                    Requirements, decisions and evidence per task
  tests/YYYY-MM-DD/           Sanitized actual test/build output
  visuals/YYYY-MM-DD/         Reviewed screenshots, recordings or API examples
  deployments/                Observed platform responses and remote SHAs
  templates/delivery-record.md
```

All maintained record prose, workbook labels and future records use English. Historical raw output may contain other languages and remains unchanged. Fixed commit links retain the original source documents. Personal documents and unsanitized logs stay outside Git.

## Historical coverage

The [historical index](historical-records.md) covers 22 earlier development/design milestones and JG-023, which organized their evidence. The original workbook also preserves its append-only update history. The 2026-11-03 backfill added JG-015 through JG-022 to the original 14 tasks. JG-023 brought the total to 23 before this language conversion.

The earliest verified clone for this collaboration is 2026-10-17 at 15:04:59 +08:00; the first development commit followed at 15:33:57. October 15/16 remains an unverified recollection. Earlier repository history is not claimed as this collaboration's work.

There are 14 previously collected sanitized logs and four reviewed images. Failed attempts remain alongside successful reruns. Missing original evidence is explicitly identified. A retrospective preparation/translation date does not become an original development date. Git dates, file modification times and hashes do not establish an independent trusted timestamp or personal work hours.

## Verified GitHub and deployment observations

On 2026-11-03, Safari sharing (`68c1235`), application documents (`a0d5882`) and progress backfill (`b4e9781`) were pushed to `origin/main` and the remote SHA was checked. On 2026-11-04, the evidence delivery was pushed as `9990678`; its Vercel check was **success**. See the [saved response](deployments/2026-11-04-delivery-9990678.json). The subsequent metadata commit `7075f65` saved that observation without claiming the check belonged to a different revision.

## Remaining acceptance boundaries

- JG-022: 272 backend tests and 80 iOS unit tests passed; two environment-dependent tests were skipped. Real API, browser and iPhone simulator acceptance passed. A later commit containing the feature, `aea1914`, had a successful Vercel check when observed on 2026-11-04. Production business writes were not repeated during the evidence backfill.
- JG-021: Safari extension and isolated-backend flows passed. Physical-device/TestFlight delivery still requires a developer Team, App Group and signing configuration.
- iOS APNs background push is not implemented. Real mail-provider consent, third-party file providers and physical-device acceptance retain their documented limitations.
- Historical counts describe their own runs and must not be added together. Completed milestones do not mean that the entire product or every production/device acceptance item is complete.

## English records delivery on 2026-11-04

[JG-024](records/2026-11-04-JG-024.md) records the English translation and validation. The original workbook now has 24 milestones. Implementation [`4046a69`](https://github.com/Enfoirer/jobgenie/commit/4046a69ac545a97fee44f68a5662a0b9bcc8afeb) was pushed and its remote SHA verified. See the [deployment observation](deployments/2026-11-04-english-records-4046a69.json) for the separately observed platform status.

The JG-024 implementation Vercel check was subsequently observed as **success**. The saved response retains the initial pending check as well. This follow-up evidence update is a separate revision.
