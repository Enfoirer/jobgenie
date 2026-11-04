# Development recording guidelines

Effective: 2026-11-04. Applies to every JobGenie feature, fix or delivery task.

Use English for maintained evidence documents, index descriptions, filenames, workbook labels and new records. Keep the existing Chinese/English iOS UI. Preserve original-language raw output and fixed historical sources; clearly date English translations instead of presenting them as contemporaneous originals.

## Files

- `project-progress.xlsx`: the original workbook, translated and renamed in place. Maintain only this workbook. Keep task IDs stable and append update rows.
- `records/YYYY-MM-DD-JG-NNN.md`: task-linked records using the [template](templates/delivery-record.md).
- `tests/YYYY-MM-DD/`: sanitized actual output, including failures and successful retries.
- `visuals/YYYY-MM-DD/`: reviewed screenshots, recordings or sanitized API examples. Identify real, test or demo environments.
- `deployments/`: observed platform responses with source, observation time, commit SHA and URL.
- `evidence-index.json`: artifact provenance, original/public hashes and milestone associations.
- `historical-records.md`: historical entry point. Link subsequent deliveries here or through a clear current overview.

## Four categories for each delivery

| Category | Record | Missing or inapplicable evidence |
| --- | --- | --- |
| Requirements and decisions | Problem, scope, acceptance criteria, changed requirements and reasons for the chosen approach; task and implementation revision | One or two sentences suffice for a simple edit. Do not invent discussion or message timestamps. |
| Tests and builds | Actual commands, environment, run/output timestamps, results and log paths | State why a check was not run. If an original log is missing, cite the historical note and label the gap. |
| Screenshots or API examples | Actual UI captures or sanitized requests/responses, revision, capture date, environment and data source | Mark documentation-only work as inapplicable. Date recaptured screenshots honestly. |
| Deployment observations | Remote SHA, platform check, observation time and deployment URL; distinguish web deployment, native compilation and app distribution | Explicitly record not deployed, pending, failed or no check returned. A push is not proof of deployment. |

## Delivery sequence

1. Complete the work and appropriate validation. Retain actual output and link failed attempts to their fixes/reruns.
2. Review and sanitize public logs/visuals. Keep credentials, personal paths and production user data out of Git. Keep untouched originals in the private parent-workspace `records/jobgenie/` directory.
3. Update all four categories, the index and the original workbook. Never infer personal hours from commits.
4. Create an English commit, push to GitHub and verify the remote SHA.
5. Save the platform observation for the actual implementation revision. If a fixed implementation link cannot refer to its own containing commit, make a subsequent records commit.
6. Report completed work, validation, push and deployment status, including remaining acceptance boundaries.

## Provenance

Historical summaries were prepared on 2026-11-04. The verified clone/development starting point is 2026-10-17; October 15/16 remains uncorroborated. Git dates and file modification times can change. A hash checks content identity; it does not provide a trusted third-party timestamp.

Keep existing acceptance documents at their paths and use fixed commit links for historical evidence. Translate the maintained documents without rewriting Git history. Preserve original results and limitations, and record the translation date. Completed milestones do not establish commercialization, revenue, personal hours or full physical-device acceptance.
