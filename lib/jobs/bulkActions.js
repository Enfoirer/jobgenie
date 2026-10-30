import mongoose from 'mongoose';
import PendingItem from '../models/PendingItem.js';
import { archiveJob, updateJob, jobError } from './jobMutations.js';
import { reviewPendingItem } from '../pipeline/pendingReview.js';

export const BULK_LIMIT = 50;
function validate(body, actions) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['ids', 'action', 'status', 'updates'].includes(key))
    || !actions.includes(body.action)) jobError('Invalid bulk action');
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > BULK_LIMIT
    || body.ids.some((id) => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) {
    jobError('Select between 1 and 50 valid records');
  }
  return [...new Set(body.ids.map((id) => id.toLowerCase()))];
}
async function run(ids, operation) {
  const results = [];
  // Each item commits independently. A failed item must not roll back successful
  // siblings, and transactions sharing the user lock should not run in parallel.
  for (const id of ids) {
    try { results.push({ id, success: true, ...await operation(id) }); }
    catch (error) {
      const status = error.status || 500;
      results.push({ id, success: false, status,
        error: status >= 500 ? 'Unable to process this record. Refresh and retry.' : error.message });
    }
  }
  const succeeded = results.filter((item) => item.success).length;
  return { total: ids.length, succeeded, failed: ids.length - succeeded, results };
}
export async function bulkJobs(userId, body) {
  const ids = validate(body, ['archive', 'restore', 'status']);
  if (Object.hasOwn(body, 'updates') || (body.action !== 'status' && Object.hasOwn(body, 'status'))
    || (body.action === 'status' && !['applied', 'interviewing', 'offer', 'rejected'].includes(body.status))) jobError('Invalid bulk application payload');
  return run(ids, (id) => body.action === 'status'
    ? updateJob(userId, id, { status: body.status }, { requireStatus: true })
    : archiveJob(userId, id, body.action === 'archive'));
}
export async function bulkPending(userId, body) {
  const ids = validate(body, ['accept', 'ignore']);
  if (Object.hasOwn(body, 'status') || (body.updates !== undefined && (!body.updates
    || typeof body.updates !== 'object' || Array.isArray(body.updates)
    || Object.keys(body.updates).some((id) => !ids.includes(id))))) jobError('Invalid bulk review payload');
  return run(ids, async (id) => {
    // Scope before review so foreign IDs and absent IDs have the same response.
    const item = await PendingItem.findOne({ _id: id, userId });
    if (!item) jobError('Pending email not found', 404);
    const updates = body.updates?.[id];
    if (updates !== undefined && (!updates || typeof updates !== 'object' || Array.isArray(updates)
      || Object.keys(updates).some((key) => !['company', 'position', 'eventType', 'interviewTime', 'deadline', 'targetJobId', 'createNew'].includes(key)))) jobError('Invalid review fields');
    // Explicit batch approval does not guess the target of an ambiguous email.
    if (body.action === 'accept' && item.status === 'pending') {
      const target = updates && Object.hasOwn(updates, 'targetJobId') ? updates.targetJobId : item.targetJobId;
      const createNew = updates && Object.hasOwn(updates, 'targetJobId') ? updates.targetJobId === null && updates.createNew === true : item.createNew === true;
      if (!target && !createNew) jobError('Choose a target application or explicitly create a new one before bulk acceptance', 409);
      if (target && !mongoose.isValidObjectId(target)) jobError('Invalid target application');
    }
    const result = await reviewPendingItem({ id, userId, action: body.action, updates, requireExplicitTarget: true });
    return { jobId: result.jobId, statusApplied: result.statusApplied };
  });
}
