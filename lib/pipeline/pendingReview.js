import mongoose from 'mongoose';
import PendingItem from '../models/PendingItem.js';
import { applyEventToJob, emailEventKey } from './jobUpdater.js';
import { cleanText, parseEmailDate, EVENT_TYPES } from './emailValidation.js';

function fail(message, status) {
  throw Object.assign(new Error(message), { status });
}

// Acceptance must share the same event identity as automatic processing. Save
// the review result and its business effects atomically, including double-clicks.
export async function reviewPendingItem({ id, userId, action, updates, requireExplicitTarget = false }) {
  if (!['accept', 'ignore', 'edit'].includes(action)) fail('Invalid action', 400);
  return mongoose.connection.transaction(async (session) => {
    const item = await PendingItem.findById(id).session(session);
    if (!item) fail('Not found', 404);
    if (item.userId.toString() !== String(userId)) fail('Not authorized', 403);
    if (item.status !== 'pending') {
      if (action === 'accept' && item.status === 'accepted') {
        return { success: true, item, jobId: item.jobId };
      }
      if (action === 'ignore' && item.status === 'ignored') return { success: true, item };
      fail('Item has already been reviewed', 409);
    }
    if (action !== 'ignore' && updates) {
      // Never permit edits to ownership or the immutable source email identity.
      for (const field of ['company', 'position']) {
        if (Object.hasOwn(updates, field)) {
          if (typeof updates[field] !== 'string') fail(`Invalid ${field}`, 400);
          item[field] = cleanText(updates[field]);
        }
      }
      if (Object.hasOwn(updates, 'eventType')) {
        if (!EVENT_TYPES.includes(updates.eventType)) fail('Choose a valid application event type', 400);
        item.eventType = updates.eventType;
      }
      for (const field of ['interviewTime', 'deadline']) {
        if (!Object.hasOwn(updates, field)) continue;
        const date = parseEmailDate(updates[field]);
        if (updates[field] && !date) fail(`Invalid ${field}: include an explicit timezone`, 400);
        item[field] = date;
      }
      if (Object.hasOwn(updates, 'targetJobId')) {
        if (updates.targetJobId !== null && !mongoose.isValidObjectId(updates.targetJobId)) fail('Invalid target application', 400);
        item.targetJobId = updates.targetJobId;
        item.createNew = updates.targetJobId === null && updates.createNew === true;
      }
    }
    // Recheck inside the transaction: a concurrent editor may have cleared the
    // target after a batch was submitted. Never fall back to automatic matching.
    if (requireExplicitTarget && action === 'accept' && !item.targetJobId && item.createNew !== true) {
      fail('Choose a target application or explicitly create a new one before bulk acceptance', 409);
    }
    if (action === 'ignore') item.status = 'ignored';
    if (action === 'accept') item.status = 'accepted';
    // First write serializes concurrent reviewers before applying any event.
    await item.save({ session });
    if (action !== 'accept') return { success: true, item };

    const applied = await applyEventToJob({
      userId, company: item.company, position: item.position,
      eventType: item.eventType, subject: item.subject, snippet: item.snippet,
      jobId: item.targetJobId, createNew: item.createNew === true,
      interviewTime: item.interviewTime, deadline: item.deadline, needsScheduling: item.needsScheduling,
      source: {
        accountId: item.accountId, provider: item.provider, messageId: item.messageId,
        threadId: item.threadId, receivedAt: item.receivedAt, subject: item.subject, from: item.from,
      },
      sourceEmailKey: emailEventKey(item.accountId, item.messageId),
    }, { session });
    item.jobId = applied.job._id;
    item.statusApplied = applied.statusApplied;
    await item.save({ session });
    return { success: true, item, jobId: applied.job._id, statusApplied: applied.statusApplied };
  }, { writeConcern: { w: 'majority' } });
}
