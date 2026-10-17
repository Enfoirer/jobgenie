import mongoose from 'mongoose';
import Job from '../models/Job.js';
import User from '../models/User.js';
import StatusHistory from '../models/StatusHistory.js';
import { findApplicationMatch } from './jobMatcher.js';
import { cleanEntity, EVENT_TYPES } from './emailValidation.js';

const statusMap = { submission: 'applied', oa: 'interviewing', interview: 'interviewing', rejection: 'rejected', offer: 'offer' };
export function emailEventKey(accountId, messageId) {
  return JSON.stringify([String(accountId), String(messageId)]);
}
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

export async function applyEventToJob(event, { session } = {}) {
  if (session) return applyInTransaction(event, session);
  return mongoose.connection.transaction((transaction) => applyInTransaction(event, transaction));
}

async function applyInTransaction(event, session) {
  const { userId, source, sourceEmailKey, eventType } = event;
  if (!source?.accountId || !source?.messageId || !['gmail', 'outlook'].includes(source.provider)
    || sourceEmailKey !== emailEventKey(source.accountId, source.messageId)) fail('Email event requires its immutable source identity');
  if (!EVENT_TYPES.includes(eventType)) fail('Choose a valid application event type');
  // Serialize email matching per user, including different messages concurrently
  // creating the same application. Transaction retries then see the winning job.
  const owner = await User.updateOne({ _id: userId }, { $inc: { mailEventVersion: 1 } }, { session });
  if (!owner.matchedCount) fail('User not found', 404);
  const existing = await StatusHistory.findOne({ sourceEmailKey, userId }).session(session);
  if (existing) {
    const job = await Job.findOne({ _id: existing.jobId, userId }).session(session);
    if (!job) fail('Previously applied email references a deleted job', 409);
    return { job, statusApplied: !existing.deletedAt && existing.statusApplied !== false, duplicate: true };
  }

  const company = cleanEntity(event.company), position = cleanEntity(event.position);
  let job;
  if (event.jobId) {
    job = await Job.findOne({ _id: event.jobId, userId }).session(session);
    if (!job) fail('Selected application is unavailable', 403);
  } else {
    if (!company || !position) fail('Company and position are required before creating an application');
    const match = event.createNew ? { kind: 'new' } : await findApplicationMatch(userId, { company, position }, session);
    if (match.kind === 'matched') job = await Job.findById(match.jobId).session(session);
    else if (match.kind !== 'new') fail('Select an existing application or explicitly create a new one', 409);
  }
  const receivedAt = source.receivedAt ? new Date(source.receivedAt) : null;
  if (receivedAt && !Number.isFinite(receivedAt.getTime())) fail('Invalid source received time');
  const trustedTime = receivedAt && receivedAt.getTime() <= Date.now() + 5 * 60_000 ? receivedAt : null;
  const targetStatus = statusMap[eventType];
  let statusApplied = true;
  if (!job) {
    [job] = await Job.create([{
      userId, company, position, status: targetStatus,
      notes: event.subject || '', dateApplied: trustedTime || new Date(),
      lastStatusEventAt: trustedTime || new Date(), applicationSource: 'Email',
    }], { session });
  } else {
    let latest = job.lastStatusEventAt || job.dateApplied;
    if (!job.lastStatusEventAt) {
      const histories = await StatusHistory.find({ jobId: job._id, userId, deletedAt: null }).session(session).lean();
      for (const history of histories) {
        const time = history.source?.receivedAt || history.createdAt || history.date;
        if (time && (!latest || new Date(time) > new Date(latest))) latest = time;
      }
    }
    // Never order events by scheduledTime: tomorrow's interview can have been
    // invited before today's rejection. Missing times also cannot overwrite.
    statusApplied = !!trustedTime && (!latest || trustedTime > new Date(latest));
    // A user may move an active history entry to a different event date. Keep
    // the same chronological rule as the manual editor, including future dates.
    if (statusApplied) {
      const latestActive = await StatusHistory.findOne({
        jobId: job._id, userId, deletedAt: null, statusApplied: { $ne: false },
      }).sort({ date: -1, createdAt: -1, _id: -1 }).session(session);
      if (latestActive && latestActive.date >= trustedTime) statusApplied = false;
    }
    if (statusApplied) {
      job.status = targetStatus;
      job.lastStatusEventAt = receivedAt;
      // Email metadata belongs to history; preserve user-entered job notes.
      await job.save({ session });
    }
  }
  await StatusHistory.create([{
    jobId: job._id, sourceEmailKey,
    source: { ...source, receivedAt, eventType }, status: targetStatus,
    date: receivedAt || new Date(), notes: event.snippet || '', userId,
    scheduledTime: event.interviewTime || undefined,
    deadline: event.deadline || undefined, needsScheduling: !!event.needsScheduling,
    interviewStage: eventType === 'oa' ? 'Online Assessment' : eventType === 'interview' ? 'Interview' : undefined,
    statusApplied,
  }], { session });
  return { job, statusApplied, duplicate: false };
}
