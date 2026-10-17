import mongoose from 'mongoose';
import PendingItem from '../models/PendingItem.js';
import { applyEventToJob, emailEventKey } from './jobUpdater.js';

function fail(message, status) {
  throw Object.assign(new Error(message), { status });
}

// Acceptance must share the same event identity as automatic processing. Save
// the review result and its business effects atomically, including double-clicks.
export async function reviewPendingItem({ id, userId, action, updates }) {
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
      for (const field of ['company', 'position', 'eventType', 'interviewTime']) {
        if (Object.hasOwn(updates, field)) item[field] = updates[field];
      }
    }
    if (action === 'ignore') item.status = 'ignored';
    if (action === 'accept') item.status = 'accepted';
    // First write serializes concurrent reviewers before applying any event.
    await item.save({ session });
    if (action !== 'accept') return { success: true, item };

    const isInterview = ['oa', 'interview'].includes(item.eventType);
    const job = await applyEventToJob({
      userId, company: item.company, position: item.position,
      eventType: item.eventType, subject: item.subject, snippet: item.snippet,
      receivedAt: (isInterview && item.interviewTime) || item.receivedAt || new Date(),
      sourceEmailKey: emailEventKey(item.accountId, item.messageId),
    }, { session });
    item.jobId = job._id;
    await item.save({ session });
    return { success: true, item, jobId: job._id };
  }, { writeConcern: { w: 'majority' } });
}
