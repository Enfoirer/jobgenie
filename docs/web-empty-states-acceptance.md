# Web empty-page guidance

Implemented and accepted locally on 2026-11-22. The Job Board, Calendar & To-do and Uploads pages provide English guidance and working actions when their successfully loaded data is empty.

## Behavior

- An account with no applications sees a create-first-application link to the existing Add Job page. Empty columns and bulk controls are replaced by that guidance. Creating an application restores the board. Archived-only records, an empty archive and a rejected-only filtered view each provide the appropriate view/filter recovery button. Existing applications retain their card, history and bulk-action behavior.
- A successfully loaded schedule with zero events shows instructions for saving interview times and assessment deadlines through the Job Board. Its action opens the applications page. Calendar navigation and category controls stay available. Existing dated or missing-time events suppress the initial guidance. An empty day/category keeps its scoped message and controls.
- An empty file library adds guidance to the existing upload/drop area. Upload your first resume opens the same file picker and uses the existing type/size/content checks. Guidance explains how to link uploaded files to application document versions. A successful upload restores the list. Deleting the last library file restores guidance. Existing files retain details, download and deletion actions.

Loading and failed reads retain their existing loading/error/retry behavior. The calendar and uploads first-use guidance requires a successful empty result. Scope is the existing web interface and authenticated APIs.

## Acceptance

The final production build and scoped JavaScript/JSX lint pass. Actual isolated NextAuth/MongoDB/Chrome acceptance checks populated and empty boards, archived-only and rejected-filter recovery, an empty archive, first-application navigation and creation, empty/existing schedules, empty categories, calendar-to-board navigation, native file-picker opening, actual PDF upload with byte verification, last-file deletion, loading/error suppression, retry, foreign-data isolation and 1280/390px layouts. The existing three-step onboarding browser suite also passes.

Six desktop/mobile captures and a sanitized acceptance example were reviewed. All accounts and records are synthetic in a disposable local database. This UI delivery uses the focused browser checks and build/lint validation. Backend unit-test totals from earlier milestones remain historical results. Deployment observations, source hashes and the original workbook update are linked from JG-031.
