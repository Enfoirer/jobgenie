# JobGenie iPhone design archive

## English prototype v0.1

- Design milestone and review date: **2026-10-29 (Asia/Shanghai)**.
- [Open the editable Figma prototype](https://www.figma.com/design/zHclDuiIWxO7Zjklt50YSC?node-id=3-33).
- File: `JobGenie — iPhone Prototype · English`, in `jy963's team`.
- Start frame: `3:33` — Applications. Select **Present** in Figma to explore the prototype.
- Language: English. Typography: Inter (approved substitute for SF Pro). Icons: [Lucide](https://lucide.dev/) vectors. Colors follow the app's teal brand.

### Scope

The prototype contains 27 editable screens and prepared result states:

| Area | Screens and flows |
| --- | --- |
| Applications | List, status filter, details, add/edit application, update status/history |
| Schedule | Upcoming events, interview time editing, rescheduling result and updated application detail |
| Email | Mailbox overview, sync results, failed-email retry result, manual review and confirmation |
| Reminders | In-app reminders, mark as read and snooze result |
| Account and analytics | Account navigation, current status distribution and historical stage conversion |
| Attachments | File library, sample upload result, resume/portfolio previews and Save to Files demonstration |

The canvas also contains reusable application-row and button components, color/spacing variables, text styles and a prototype guide.

### Review evidence

On 2026-10-29, the Figma document structure was checked:

- 27 screens reachable from the Applications start frame.
- 85 navigation actions with no invalid destination IDs.
- No missing fonts, zero-width text or unfinished screen placeholders.
- Main screens and result states visually reviewed; corrected the filtered application's badge and company-mark background contrast.

These are design structure and screenshot checks, not an automated click-through test or an app/backend acceptance test. See [the iOS README](../../../ios/README.md) for implementation and runtime test results.

### Prototype limitations

Actions navigate between prepared sample states. Search, text entry, live mailbox authorization and native file picking are not connected. Upload, download, sync and save actions do not change real account data. The prototype does not claim background push support; the current app has in-app reminders only.

### Version tracking

This Git commit archives the link, milestone description and review evidence. The Figma URL points to the **live file** and can show later changes; it is not a frozen design snapshot. No PNG/PDF export, `.fig` backup or Figma named-version ID is included in this milestone.

Figma maintains its own timestamped version history. Use the file menu's **Show version history** to inspect it. History availability depends on the file's plan/location; see [Figma's version-history documentation](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history). A named Figma version has not been created or verified as part of this archive.

For subsequent milestones, add a dated entry to [CHANGELOG.md](CHANGELOG.md) and commit the corresponding design description. If an immutable visual record is needed, include exported snapshots and the exact Figma version link when available. There is currently no automatic Figma-to-GitHub synchronization.
