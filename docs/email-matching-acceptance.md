# Email extraction and application matching acceptance

## Decisions

The chosen Semi/Strict policy is:

| Mode | Existing, unambiguous application | New application | Offer/rejection |
| --- | --- | --- | --- |
| Auto | May apply above the configured confidence threshold | May create with complete, grounded fields | May apply when all checks pass |
| Semi (default) | May apply submission, assessment and interview updates above threshold | Human review | Human review |
| Strict | Human review | Human review | Human review |

Marketing/non-status emails are discarded in every mode. Invalid fields, missing
source times, uncertain/ambiguous matches and low confidence always require review.
A human's explicit target selection is limited to applications owned by that user.

## Processing

1. Classify the event independently using conservative status phrases. A generic
   mention of interviews, scheduling or congratulations alone is insufficient.
2. Extract company/position and scheduling fields even when classification is
   confident. With an API key, the AI extractor runs for every potentially
   relevant email. Without one, explicit Company/Position labels are extracted;
   unresolved fields remain reviewable rather than generating Unknown jobs.
3. Validate the response before matching. Confidence must be a finite numeric
   value in [0, 1], booleans must be actual booleans, and events must be one of
   submission/oa/interview/rejection/offer. Invalid values cannot raise confidence.
4. Dates require complete ISO timestamps with a timezone. Invalid calendar dates,
   timezone-free local times and ambiguous natural-language dates are not stored
   as dates. Missing dates stay empty for review. Valid offsets normalize to UTC.
5. Company/position evidence must occur in the source email. This is a conservative
   token check, not a guarantee of model semantic accuracy. Invented, missing or
   placeholder names cannot trigger automatic application creation.
6. Match inside the authenticated user's applications. Normalize case, Unicode,
   punctuation and company legal suffixes; normalize SWE and role token order.
   Seniority, C/C++/C# distinctions and distinct roles are retained. Near names only produce suggestions.
   Two exact matches never result in an arbitrary choice.
7. Persist the original mailbox/message/thread identity, subject, sender and
   received time on each email-generated history entry. Keep scheduledTime and
   deadline separate from the received timestamp. Gmail uses its authoritative
   internalDate when available instead of trusting a sender-controlled Date header.

Extraction API errors and malformed JSON still fail the durable queue attempt
and retry later. Well-formed but invalid field values go to human review instead
of causing a Mongoose cast error or silently changing an application.

## Ordering and atomicity

Email application matching and writes share a transaction. A per-user counter
serializes concurrent email matching so two distinct messages cannot both create
an application from the same previously empty match set. Source-event uniqueness
continues to protect against retries and repeated human acceptance.

`Job.lastStatusEventAt` is the current-state watermark. Email updates use the
provider's received time; manual status actions establish a server-time watermark.
An older or equal-time email can add a source-linked history entry but cannot
replace the current status. It has `statusApplied: false`; background processing
reports `outcome: historical`. Missing/untrusted received times also cannot
replace an existing status. The interview appointment date never decides status
ordering. Existing application notes are preserved.

For legacy jobs without a watermark, history received times, or legacy history
creation times, are compared with dateApplied conservatively. Existing records
are not bulk rewritten. A legacy event without provenance cannot be reconstructed
with certainty. Restart development servers after changing Mongoose schemas;
deploy all routes together. No additional index migration is needed for these
additive fields (the earlier mail index rollout is still required).

Manual acceptance may link a selected owned application or explicitly create a
new one after company/position are filled in. Ambiguous candidates require that
choice. It cannot force an old email to overwrite newer state; use the normal
manual status control for an intentional current-status change.

History entries display source and scheduling information. Pending review shows
human-readable reasons, application selection and editable scheduling fields.
Current-state funnel counts use Job.status, not historical email events.

## Fixed acceptance corpus

The checked-in corpus is `tests/fixtures/application-emails.json`.

| Fixture | Expected event | Expected handling in Auto against one matching application |
| --- | --- | --- |
| Application confirmation | submission | Applied, company/position extracted |
| Coding assessment | oa | Interviewing, deadline retained |
| Interview invitation | interview | Interviewing, timezone-normalized scheduled time retained |
| Rejection after an interview | rejection | Rejected; mention of an interview does not override the rejection |
| Employment offer | offer | Offer |
| Newsletter / recommended jobs | non-status | No pending item or business history |
| Invitation missing company/position | interview | Pending; no Unknown Company/Position job |

The same seven fixtures are replayed through classification/extraction and through
real MongoDB replica-set ingestion, matching and history writes. AI responses are
fixed replay data: tests make no paid API requests and measure deterministic
pipeline behavior, not live model accuracy. Separate cases cover malformed values,
Chinese labels, name normalization, multiple/near candidates, cross-user targets,
selected Semi/Strict behavior, stale events, equal timestamps, scheduled-date vs
received-date ordering, retries and concurrent distinct messages.

Validation on 2026-10-17: `npm test` passed all 97 cases; scoped ESLint checks
(including JSX) and `git diff --check` passed. The local production build passed
using the installed Next.js 15.3.1; production dependency validation is separate.

Run `npm test`. Production compilation also needs `npm run build`; the repository
pins Next.js 15.5.28 and its matching ESLint configuration. Local installation was
previously interrupted by the proxy, so check installed and locked versions before
claiming a build used the upgraded framework. Vercel's build status verifies the
actual locked production dependencies.
