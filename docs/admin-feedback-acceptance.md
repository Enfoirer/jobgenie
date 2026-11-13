# Administrator feedback review

Implemented on 2026-11-13. The English web page at `/dashboard/admin/feedback` displays saved product feedback with overall/recommendation ratings, suggestions, submission time, platform, version, source, locale and campaign. Navigation shows Feedback review for authorized administrators.

## Access and setup

Existing and newly registered accounts use the ordinary user role. Each page request and API read checks the current database role. Only `role=admin` can read the cross-account feedback list. Registration accepts its existing name/email/password fields. Grant/revoke administration through a trusted operator command with the intended database configured in `MONGODB_URI`.

```sh
npm run admin:manage -- grant account@example.com
npm run admin:manage -- revoke account@example.com
```

The account must already exist. This operator command can change only the role and returns generic outcomes. The production administrator account awaits owner designation. `/api/admin/access` controls navigation visibility. `/api/admin/feedback` independently checks access for every request. Revocation applies to subsequent reads. A response already read by an administrator may remain visible until refresh. A denied refresh clears the displayed data.

## Filters and privacy

Platform, exact app version, missing version, response source and optional UTC calendar dates combine. Both boundary dates include their full UTC day. Missing legacy metadata is displayed as Unknown and missing versions have a distinct filter. The list is newest first with 25 responses per page and a timestamp/ID cursor for tied timestamps. Cursor paging retains active filters. New submissions can change the matching count while an administrator browses.

Manual and automatic-invitation sources remain visible for analysis. Ratings use the original five-star scale. Written suggestions render as React text. Explicit response fields omit account identifiers, email addresses, passwords, invitation IDs and auth credentials. Private no-store response headers apply to successful and failed API reads. Errors use generic server-failure text and do not log requests, comments or exception contents.

## Acceptance

Eight isolated backend tests cover anonymous/ordinary/legacy users, grants/revocation/deleted admins, protected registration, explicit response fields, cache headers, filter/date boundaries, legacy Unknown values, malformed/duplicate/injection filters, tied timestamp paging and safe failures.

The actual local NextAuth/browser flow checks page and API denial, a temporary database grant, version filtering, empty results, literal HTML suggestions, mobile bounds, permission revocation clearing and signed-out 401. Synthetic data and a disposable MongoDB replica set are used. Production build, scoped JSX lint and full backend regression results are linked from the development progress record. Native application compilation was unnecessary for this web feature.
