# Repository workflow

User preferences for this repository:

- After completing and validating an authorized feature or fix, create a Git commit without waiting for a separate request. Write commit subjects and bodies in English. Stage only changes belonging to the task.
- Update `docs/progress/JobGenie项目进展.xlsx` whenever work is completed or its status changes. Keep task IDs stable, update the Gantt dates/status, and append to the existing 更新日志 sheet rather than overwriting history.
- Keep `docs/progress/README.md` current with the update date, evidence links, and relevant remaining acceptance boundaries. If the original workbook in the parent workspace's `outputs/01a148ab-823d-7780-b9ac-5e411f869856/` directory exists, refresh that copy from the canonical repository workbook after updating it.
- Record actual test results and dates. Distinguish implementation, local acceptance, production deployment, and signed-device/TestFlight acceptance. Do not mark deployment or real-provider verification complete merely because local tests passed.
- Include progress updates with the delivery. When a fixed commit link cannot refer to the commit containing the workbook itself, make a subsequent progress-record commit that links to the completed implementation commit.
- A request to commit does not itself authorize pushing, deployment, or TestFlight distribution. Follow the user's authorization for those actions.
