import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import ProcessedEmail from '../models/ProcessedEmail.js';
import PendingItem from '../models/PendingItem.js';
import User from '../models/User.js';
import MailAccount from '../models/MailAccount.js';
import { fetchGmailMessages } from '../mail/gmail.js';
import { fetchOutlookMessages } from '../mail/outlook.js';
import { processEmailForPending } from './emailProcessor.js';
import { applyEventToJob, emailEventKey } from './jobUpdater.js';
import { findApplicationMatch } from './jobMatcher.js';
import { decideSyncAction } from './syncPolicy.js';
import { normalizeSyncLimit } from '../mail/syncOptions.js';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

// Retry stored work even when the provider is unavailable or returns no mail.
export async function syncMailAccounts(accounts, {
  limit = 10,
  retryLimit = 50,
  leaseMs = DEFAULT_LEASE_MS,
  fetchers = { gmail: fetchGmailMessages, outlook: fetchOutlookMessages },
  parseEmail = processEmailForPending,
} = {}) {
  limit = normalizeSyncLimit(limit);
  const result = { emails: [], errors: [], accounts: [], ...emptyCounts() };
  for (const account of accounts) {
    const summary = {
      accountId: String(account._id), provider: account.provider, emailAddress: account.emailAddress,
      ...emptyCounts(), hasMore: false, hasPendingWork: false,
      backlog: { pending: 0, processing: 0, failed: 0, pendingReview: 0 },
    };
    result.accounts.push(summary);
    const reportError = (stage, error, messageId) => result.errors.push({
      accountId: String(account._id), provider: account.provider,
      emailAddress: account.emailAddress,
      stage, messageId, message: error.message,
    });
    try {
      const batch = await fetchers[account.provider](account, { limit });
      summary.totalFetched += batch.messages.length;
      summary.pagesFetched += batch.pagesFetched || 0;
      summary.unavailable += batch.unavailable || 0;
      summary.cursorResets += batch.cursorResets || 0;
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
        if (inserted) {
          result.emails.push(raw);
          summary.stored++;
        } else summary.skipped++;
      }
      const metadata = account.metadata?.toObject?.() || account.metadata || {};
      account.metadata = { ...metadata, ...batch.cursor, lastFetchedAt: new Date() };
      try {
        await account.save({ writeConcern: { w: 'majority' } });
      } catch (error) {
        // Keep the in-memory object at its committed position too.
        account.metadata = metadata;
        throw error;
      }
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
        if (claimed.attempts > 1) summary.retried++;
        try {
          const parsed = await parseEmail(claimed.raw);
          const outcome = await completeEmail(claimed, token, parsed, settings);
          summary.processed++;
          if (outcome === 'applied') summary.applied++;
          else if (outcome === 'historical') summary.historical++;
          else if (outcome === 'pending_review') summary.pendingReview++;
          else summary.irrelevant++;
        } catch (error) {
          summary.failed++;
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
    try {
      // Read the committed continuation rather than trusting a fetched batch or
      // a failed cursor save. Counts describe the backlog after this invocation.
      const [savedAccount, queue, pendingReview] = await Promise.all([
        MailAccount.findById(account._id, { metadata: 1 }).lean(),
        ProcessedEmail.aggregate([
          { $match: { accountId: account._id, userId: account.userId, status: { $in: ['pending', 'processing', 'failed'] } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        PendingItem.countDocuments({ accountId: account._id, userId: account.userId, status: 'pending' }),
      ]);
      for (const entry of queue) summary.backlog[entry._id] = entry.count;
      summary.backlog.pendingReview = pendingReview;
      summary.hasMore = !!(savedAccount?.metadata?.gmailSync || savedAccount?.metadata?.outlookSync);
      summary.hasPendingWork = ['pending', 'processing', 'failed'].some((key) => summary.backlog[key] > 0);
    } catch (error) {
      // Do not report unknown state as an empty queue.
      summary.backlog = null;
      summary.hasMore = null;
      summary.hasPendingWork = null;
      reportError('summary', error);
    }
    summary.errorCount = result.errors.filter((error) => error.accountId === summary.accountId).length;
    for (const key of Object.keys(emptyCounts())) result[key] += summary[key];
  }
  result.hasMore = result.accounts.some((a) => a.hasMore === true) ? true
    : result.accounts.some((a) => a.hasMore === null) ? null : false;
  result.hasPendingWork = result.accounts.some((a) => a.hasPendingWork === true) ? true
    : result.accounts.some((a) => a.hasPendingWork === null) ? null : false;
  return result;
}

function emptyCounts() {
  return {
    totalFetched: 0, stored: 0, skipped: 0, processed: 0, failed: 0, retried: 0,
    applied: 0, historical: 0, pendingReview: 0, irrelevant: 0, unavailable: 0,
    pagesFetched: 0, cursorResets: 0, errorCount: 0,
  };
}

function eligibleForProcessing(now) {
  return { $or: [
    { status: { $in: ['pending', 'failed'] } },
    { status: 'processing', leaseUntil: { $lte: now } },
  ] };
}

async function completeEmail(email, token, processed, settings) {
  if (!processed || typeof processed.shouldCreate !== 'boolean') {
    throw new Error('Email parser returned an invalid result');
  }
  return mongoose.connection.transaction(async (session) => {
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
      const confidence = parsed.confidence ?? 0;
      const message = email.raw;
      const sourceTime = email.receivedAt || (message.receivedAt ? new Date(message.receivedAt) : null);
      const reviewReasons = [...(parsed.reviewReasons || [])];
      if (!sourceTime || !Number.isFinite(new Date(sourceTime).getTime()) || new Date(sourceTime).getTime() > Date.now() + 5 * 60_000) reviewReasons.push('invalid_received_time');
      const match = await findApplicationMatch(email.userId, parsed, session);
      const decision = decideSyncAction({ ...parsed, reviewReasons }, match, settings || {});
      if (decision.action === 'apply') {
        const applied = await applyEventToJob({
          userId: email.userId, company: parsed.company, position: parsed.position,
          eventType: parsed.eventType, jobId: match.jobId,
          subject: message.subject, snippet: message.snippet,
          interviewTime: parsed.interviewTime, deadline: parsed.deadline, needsScheduling: parsed.needsScheduling,
          source: {
            accountId: email.accountId, messageId: email.messageId, provider: email.provider,
            threadId: email.threadId, receivedAt: sourceTime, subject: message.subject, from: message.from,
          },
          sourceEmailKey: emailEventKey(email.accountId, email.messageId),
        }, { session });
        owned.outcome = applied.statusApplied ? 'applied' : 'historical';
        owned.jobId = applied.job._id;
      } else {
        await PendingItem.updateOne({
          accountId: email.accountId, messageId: email.messageId,
        }, { $setOnInsert: {
          userId: email.userId, provider: email.provider, messageId: email.messageId,
          accountId: email.accountId, threadId: email.threadId,
          subject: message.subject, from: message.from, to: message.to,
          snippet: message.snippet, receivedAt: sourceTime, raw: message,
          company: parsed.company, position: parsed.position,
          interviewTime: parsed.interviewTime, deadline: parsed.deadline,
          needsScheduling: parsed.needsScheduling, eventType: parsed.eventType || 'other',
          confidence, recommendedAction: parsed.recommendedAction,
          summary: parsed.summary, rationale: parsed.rationale, isRelevant: true, status: 'pending',
          targetJobId: match.jobId || undefined, matchStatus: match.kind, candidates: match.candidates,
          reviewReasons: decision.reasons, validationErrors: parsed.validationErrors || [], extractionMethod: parsed.extractionMethod,
        } }, { session, upsert: true });
        owned.outcome = 'pending_review';
      }
    }
    await owned.save({ session });
    return owned.outcome;
  }, { writeConcern: { w: 'majority' } });
}
