import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import ProcessedEmail from '../models/ProcessedEmail.js';
import PendingItem from '../models/PendingItem.js';
import User from '../models/User.js';
import { fetchGmailMessages } from '../mail/gmail.js';
import { fetchOutlookMessages } from '../mail/outlook.js';
import { processEmailForPending } from './emailProcessor.js';
import { applyEventToJob, emailEventKey } from './jobUpdater.js';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

// Retry stored work even when the provider is unavailable or returns no mail.
export async function syncMailAccounts(accounts, {
  limit = 10,
  retryLimit = 50,
  leaseMs = DEFAULT_LEASE_MS,
  fetchers = { gmail: fetchGmailMessages, outlook: fetchOutlookMessages },
  parseEmail = processEmailForPending,
} = {}) {
  const result = {
    emails: [], errors: [], skipped: 0, totalFetched: 0,
    processed: 0, failed: 0, retried: 0,
  };
  for (const account of accounts) {
    const reportError = (stage, error, messageId) => result.errors.push({
      provider: account.provider,
      emailAddress: account.emailAddress,
      stage, messageId, message: error.message,
    });
    try {
      const batch = await fetchers[account.provider](account, { limit });
      result.totalFetched += batch.messages.length;
      // A partial batch is safe: saved rows can be processed, and the unchanged
      // provider cursor allows the remaining messages to be fetched again.
      for (const message of batch.messages) {
        if (typeof message.id !== 'string' || !message.id) {
          throw new Error('Fetched email has no message ID');
        }
        const raw = {
          ...message, accountId: account._id, userId: account.userId,
          emailAddress: account.emailAddress,
        };
        const key = { accountId: account._id, messageId: message.id };
        let inserted;
        try {
          const write = await ProcessedEmail.updateOne(key, { $setOnInsert: {
            ...key, provider: account.provider, userId: account.userId,
            threadId: message.threadId,
            receivedAt: message.receivedAt ? new Date(message.receivedAt) : undefined,
            raw, status: 'pending', attempts: 0,
          } }, { upsert: true, writeConcern: { w: 'majority' } });
          inserted = write.upsertedCount > 0;
        } catch (error) {
          // Another sync can win the unique account/message upsert race.
          if (error.code !== 11000 || !await ProcessedEmail.exists(key)) throw error;
          inserted = false;
        }
        if (inserted) result.emails.push(raw);
        else result.skipped++;
      }
      const metadata = account.metadata?.toObject?.() || account.metadata || {};
      account.metadata = cursorAfterBatch(account.provider, metadata, batch);
      await account.save({ writeConcern: { w: 'majority' } });
    } catch (error) {
      reportError('ingest', error);
    }

    try {
      const settings = await User.findById(account.userId, { syncMode: 1, autoThreshold: 1 }).lean();
      // Snapshot candidates: retry a failure on the next sync, not in an
      // unbounded loop within this request. Old failures cannot starve new rows.
      const candidates = await ProcessedEmail.find({
        accountId: account._id, userId: account.userId, raw: { $exists: true },
        ...eligibleForProcessing(new Date()),
      }).sort({ updatedAt: 1, _id: 1 }).limit(retryLimit).lean();
      for (const candidate of candidates) {
        const token = randomUUID();
        const now = new Date();
        const claimed = await ProcessedEmail.findOneAndUpdate({
          _id: candidate._id, ...eligibleForProcessing(now),
        }, {
          $set: { status: 'processing', leaseToken: token, leaseUntil: new Date(now.getTime() + leaseMs) },
          $inc: { attempts: 1 },
        }, { new: true, writeConcern: { w: 'majority' } }).lean();
        if (!claimed) continue;
        if (claimed.attempts > 1) result.retried++;
        try {
          const parsed = await parseEmail(claimed.raw);
          await completeEmail(claimed, token, parsed, settings);
          result.processed++;
        } catch (error) {
          result.failed++;
          reportError('process', error, claimed.messageId);
          // A stale worker cannot overwrite a newer owner's result.
          await ProcessedEmail.updateOne({
            _id: claimed._id, status: 'processing', leaseToken: token,
          }, {
            $set: { status: 'failed', lastError: error.message.slice(0, 2000) },
            $unset: { leaseToken: 1, leaseUntil: 1 },
          }, { writeConcern: { w: 'majority' } });
        }
      }
    } catch (error) {
      reportError('queue', error);
    }
  }
  return result;
}

function eligibleForProcessing(now) {
  return { $or: [
    { status: { $in: ['pending', 'failed'] } },
    { status: 'processing', leaseUntil: { $lte: now } },
  ] };
}

function cursorAfterBatch(provider, previous, batch) {
  const next = { ...previous, lastFetchedAt: new Date() };
  if (provider === 'gmail') {
    // Gmail IDs can exceed JS safe integers; compare exact strings with BigInt.
    const ids = batch.messages.map((m) => m.historyId).filter((id) => /^\d+$/.test(id));
    if (ids.length) next.historyId = ids.reduce((a, b) => BigInt(a) > BigInt(b) ? a : b);
    else if (batch.newHistoryId) next.historyId = String(batch.newHistoryId);
  } else {
    const times = batch.messages.map((m) => new Date(m.receivedAt).getTime()).filter(Number.isFinite);
    if (times.length) next.lastReceivedAt = new Date(Math.max(...times));
    else if (batch.latestReceivedAt) next.lastReceivedAt = new Date(batch.latestReceivedAt);
  }
  return next;
}

async function completeEmail(email, token, processed, settings) {
  if (!processed || typeof processed.shouldCreate !== 'boolean') {
    throw new Error('Email parser returned an invalid result');
  }
  await mongoose.connection.transaction(async (session) => {
    // Write the owned row first to fence expired workers. Success, review item,
    // job and history all commit together or roll back together.
    const owned = await ProcessedEmail.findOneAndUpdate({
      _id: email._id, status: 'processing', leaseToken: token,
    }, {
      $set: { status: 'succeeded', processedAt: new Date() },
      $unset: { leaseToken: 1, leaseUntil: 1, lastError: 1 },
    }, { session, new: true });
    if (!owned) throw new Error('Email processing lease was replaced');
    if (!processed.shouldCreate) {
      owned.outcome = 'skipped';
    } else {
      const parsed = processed.parsed;
      if (!parsed) throw new Error('Email parser returned no extracted fields');
      const confidence = parsed.confidence ?? 0.5;
      const message = email.raw;
      if (settings?.syncMode === 'auto' && confidence >= (settings.autoThreshold ?? 0.7)) {
        const job = await applyEventToJob({
          userId: email.userId, company: parsed.company, position: parsed.position,
          eventType: parsed.eventType || 'other',
          subject: message.subject, snippet: message.snippet,
          receivedAt: ['oa', 'interview'].includes(parsed.eventType)
            ? parsed.interviewTime || email.receivedAt : email.receivedAt,
          sourceEmailKey: emailEventKey(email.accountId, email.messageId),
        }, { session });
        owned.outcome = 'applied';
        owned.jobId = job._id;
      } else {
        await PendingItem.updateOne({
          accountId: email.accountId, messageId: email.messageId,
        }, { $setOnInsert: {
          userId: email.userId, provider: email.provider, messageId: email.messageId,
          accountId: email.accountId, threadId: email.threadId,
          subject: message.subject, from: message.from, to: message.to,
          snippet: message.snippet, receivedAt: email.receivedAt, raw: message,
          company: parsed.company, position: parsed.position,
          interviewTime: parsed.interviewTime, deadline: parsed.deadline,
          needsScheduling: parsed.needsScheduling, eventType: parsed.eventType || 'other',
          confidence, recommendedAction: parsed.recommendedAction,
          summary: parsed.summary, rationale: parsed.rationale, isRelevant: true, status: 'pending',
        } }, { session, upsert: true });
        owned.outcome = 'pending_review';
      }
    }
    await owned.save({ session });
  }, { writeConcern: { w: 'majority' } });
}
