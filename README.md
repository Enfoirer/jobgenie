# JobGenie

Next.js 15 app for tracking job applications with email ingestion, status timeline, document uploads, and credential auth.

web app: https://jobgenie-six.vercel.app

## Key Features
- Job board (drag-and-drop), add job form, uploads, auth-protected dashboard.
- Email agent: Gmail/Outlook OAuth, incremental fetch (Gmail historyId, Outlook receivedAt filter), rule+LLM parsing, relevance filtering, pending review queue, sync modes (auto/semi/strict), job/status auto-update.
- Timeline & status history per job; accept/ignore pending items and update Job/StatusHistory.
- File uploads stored in MongoDB per user.

## Quick Start
```bash
npm install
npm run dev
# open http://localhost:3000
```

## Environment Variables
- `MONGODB_URI` – MongoDB connection string.
- `NEXTAUTH_URL` – base URL (e.g. http://localhost:3000 or your production domain).
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- Outlook OAuth: `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID` (or `common`), `NEXT_PUBLIC_OUTLOOK_CLIENT_ID`, `NEXT_PUBLIC_OUTLOOK_TENANT_ID`
- OpenAI (optional, for LLM parsing): `OPENAI_API_KEY`, `OPENAI_MODEL` (default gpt-4o-mini)
- Cron auth: `CRON_SECRET` (used by `/api/mail/cron?token=...`)

## Email Agent Overview
- **Auth**: Connect Gmail/Outlook via UI, tokens stored in MongoDB; auto-refresh with refresh tokens.
- **Fetch**: Incremental (Gmail historyId; Outlook by receivedAt), messageId dedupe (ProcessedEmail).
- **Parse**: Rule filters drop marketing/recommendations; LLM (optional) extracts structured fields; only status updates (submission/oa/interview/rejection/offer) kept.
- **Sync modes**: Auto (high-confidence updates Job/StatusHistory directly), Semi/Strict (everything goes to Pending). Per-user settings via `/api/sync-settings`.
- **Pending**: Review, edit key fields, accept/ignore; accept updates Job and StatusHistory.
- **Scheduling**: Use an external scheduler (e.g. cron-job.org) to call `/api/mail/cron?limit=10&token=<CRON_SECRET>`.

### Pipeline (Mermaid)
```mermaid
flowchart TD
  A[OAuth Gmail/Outlook] --> B["Fetch messages&#10;(Gmail historyId / Outlook receivedAt)"]
  B --> C[Dedup by messageId]
  C --> D[Rule filter: spam/recommendations]
  D -->|irrelevant| Z[Skip]
  D --> E[Rule classify]
  E --> F[LLM (optional): status update only]
  F -->|isStatusUpdate=false| Z
  F --> G[Result fusion (eventType, confidence, fields)]
  G -->|auto & conf >= threshold| H[Update Job + StatusHistory]
  G -->|otherwise| I[Create PendingItem]
  I --> J[Pending UI Accept/Ignore/Edit]
  J -->|Accept| H
```

## Manual Triggers
- Logged-in user: `/api/mail` (optional `?limit=10`).
- External cron: `/api/mail/cron?limit=10&token=<CRON_SECRET>`.

## Notes
- PendingItem/ProcessedEmail stored per user in MongoDB.
- OA/Interview times use parsed scheduledTime when available, otherwise email received time; submission/offer/rejection use received time.
- Auto mode only applies to status updates with confidence above the user threshold; others go to Pending or are skipped if non-status.
