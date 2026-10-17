import mongoose from 'mongoose';
import Job from '../models/Job.js';
import StatusHistory from '../models/StatusHistory.js';
import { COLUMNS } from '../mockData.js';

const statusMap = {
  submission: COLUMNS.APPLIED,
  oa: COLUMNS.INTERVIEWING,
  interview: COLUMNS.INTERVIEWING,
  rejection: COLUMNS.REJECTED,
  offer: COLUMNS.OFFER,
  other: COLUMNS.APPLIED,
};

export function emailEventKey(accountId, messageId) {
  return JSON.stringify([String(accountId), String(messageId)]);
}

// Include the event in the caller's transaction, or own one. Never fall back to
// separate writes on standalone MongoDB: that would lose the atomicity guarantee.
export async function applyEventToJob(event, { session } = {}) {
  if (session) return applyInTransaction(event, session);
  return mongoose.connection.transaction((transaction) =>
    applyInTransaction(event, transaction)
  );
}

async function applyInTransaction({
  userId, company, position, eventType, subject, snippet, receivedAt, sourceEmailKey,
}, session) {
  if (!sourceEmailKey) throw new Error('Email event requires a sourceEmailKey');
  const existing = await StatusHistory.findOne({ sourceEmailKey, userId }).session(session);
  if (existing) {
    const job = await Job.findOne({ _id: existing.jobId, userId }).session(session);
    if (!job) throw new Error('Previously applied email references a deleted job');
    return job;
  }

  const targetStatus = statusMap[eventType] || COLUMNS.APPLIED;
  let job = null;
  if (company || position) {
    job = await Job.findOne({
      userId,
      ...(company ? { company } : {}),
      ...(position ? { position } : {}),
    }).session(session);
  }
  if (!job) {
    [job] = await Job.create([{
      userId,
      company: company || 'Unknown Company',
      position: position || 'Unknown Position',
      status: targetStatus,
      notes: subject || '',
      dateApplied: receivedAt || new Date(),
      applicationSource: 'Email',
    }], { session });
  } else {
    job.status = targetStatus;
    job.notes = subject || job.notes;
    await job.save({ session });
  }
  await StatusHistory.create([{
    jobId: job._id,
    sourceEmailKey,
    status: targetStatus,
    date: receivedAt || new Date(),
    notes: snippet || '',
    userId,
  }], { session });
  return job;
}
