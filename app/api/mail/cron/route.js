// app/api/mail/cron/route.js
// Triggered by external cron with Authorization: Bearer <CRON_SECRET>
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import ProcessedEmail from '@/lib/models/ProcessedEmail';
import PendingItem from '@/lib/models/PendingItem';
import { fetchGmailMessages } from '@/lib/mail/gmail';
import { fetchOutlookMessages } from '@/lib/mail/outlook';
import { classifyEmail } from '@/lib/classify/emailClassifier';
import { processEmailForPending } from '@/lib/pipeline/emailProcessor';

export async function GET(request) {
  await dbConnect();

  const auth = request.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get('token');

  const authorized =
    secret &&
    (auth === `Bearer ${secret}` || (tokenParam && tokenParam === secret));

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider');
  const limitParam = searchParams.get('limit');
  const limit = Number.isInteger(Number(limitParam))
    ? Math.min(Number(limitParam), 50)
    : 10;

  try {
    const query = {};
    if (provider) query.provider = provider;
    const accounts = await MailAccount.find(query);
    if (accounts.length === 0) {
      return NextResponse.json({ emails: [], accounts: [] });
    }

    const results = [];
    const errors = [];
    let skipped = 0;

    for (const account of accounts) {
      try {
        const userId = account.userId;

        if (account.provider === 'gmail') {
          const { messages, newHistoryId } = await fetchGmailMessages(account, { limit });
          results.push(
            ...messages.map((m) => ({
              ...m,
              accountId: account._id,
              emailAddress: account.emailAddress,
              userId,
            }))
          );
          const maxHistoryId = messages.reduce((max, m) => {
            const h = Number(m.historyId || 0);
            return Number.isNaN(h) ? max : Math.max(max, h);
          }, 0);
          account.metadata = {
            ...account.metadata,
            lastFetchedAt: new Date(),
            ...(maxHistoryId > 0
              ? { historyId: String(maxHistoryId) }
              : newHistoryId
                ? { historyId: String(newHistoryId) }
                : {}),
          };
          await account.save();
        } else if (account.provider === 'outlook') {
          const { messages, latestReceivedAt } = await fetchOutlookMessages(account, { limit });
          results.push(
            ...messages.map((m) => ({
              ...m,
              accountId: account._id,
              emailAddress: account.emailAddress,
              userId,
            }))
          );
          const latestReceived = messages.reduce((latest, m) => {
            const ts = m.receivedAt ? new Date(m.receivedAt).getTime() : 0;
            return ts > latest ? ts : latest;
          }, 0);
          account.metadata = {
            ...account.metadata,
            lastFetchedAt: new Date(),
            ...(latestReceived
              ? { lastReceivedAt: new Date(latestReceived) }
              : latestReceivedAt
                ? { lastReceivedAt: new Date(latestReceivedAt) }
                : {}),
          };
          await account.save();
        }
      } catch (err) {
        console.error(
          `CRON mail fetch failed for ${account.provider} (${account.emailAddress}):`,
          err
        );
        errors.push({
          provider: account.provider,
          emailAddress: account.emailAddress,
          message: err.message,
        });
      }
    }

    const emailsByAccount = results.reduce((map, msg) => {
      if (!map[msg.accountId]) {
        map[msg.accountId] = [];
      }
      map[msg.accountId].push(msg);
      return map;
    }, {});

    const finalEmails = [];

    for (const account of accounts) {
      const msgs = emailsByAccount[account._id] || [];
      if (msgs.length === 0) continue;

      const ids = msgs.map((m) => m.id);
      const existing = await ProcessedEmail.find(
        { accountId: account._id, messageId: { $in: ids } },
        { messageId: 1 }
      ).lean();
      const existingSet = new Set(existing.map((e) => e.messageId));

      const newMessages = msgs.filter((m) => !existingSet.has(m.id));
      skipped += msgs.length - newMessages.length;
      finalEmails.push(...newMessages);

      if (newMessages.length > 0) {
        try {
          await ProcessedEmail.insertMany(
            newMessages.map((m) => ({
              provider: m.provider,
              accountId: account._id,
              userId: m.userId,
              messageId: m.id,
              threadId: m.threadId,
              receivedAt: m.receivedAt ? new Date(m.receivedAt) : undefined,
            })),
            { ordered: false }
          );
        } catch (e) {
          if (e.code !== 11000) {
            console.error('insertMany processed emails failed', e);
          }
        }

        for (const m of newMessages) {
          const processed = await processEmailForPending(m);
          if (!processed?.shouldCreate) {
            continue;
          }
          const parsed = processed.parsed || classifyEmail(m);
          const item = {
            userId: m.userId,
            accountId: account._id,
            provider: account.provider,
            messageId: m.id,
            threadId: m.threadId,
            subject: m.subject,
            from: m.from,
            to: m.to,
            snippet: m.snippet,
            receivedAt: m.receivedAt ? new Date(m.receivedAt) : undefined,
            raw: m,
            company: parsed.company,
            position: parsed.position,
            interviewTime: parsed.interviewTime,
            eventType: parsed.eventType,
            confidence: parsed.confidence || parsed.confidence === 0 ? parsed.confidence : 0.5,
            recommendedAction: parsed.recommendedAction,
            summary: parsed.summary,
            rationale: parsed.rationale,
            isRelevant: true,
          };
          try {
            await PendingItem.create(item);
          } catch (err) {
            if (err.code !== 11000) {
              console.error('Failed to create pending item', err);
            }
          }
        }
      }
    }

    return NextResponse.json({
      emails: finalEmails,
      errors,
      skipped,
      totalFetched: results.length,
    });
  } catch (error) {
    console.error('GET /api/mail/cron - Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mail', details: error.message },
      { status: 500 }
    );
  }
}
