import mongoose from 'mongoose';
import Job from '../models/Job.js';
import User from '../models/User.js';
import StatusHistory from '../models/StatusHistory.js';
import { parseEmailDate } from '../pipeline/emailValidation.js';

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected'];
const jobFields = ['company', 'position', 'location', 'notes', 'jobUrl', 'applicationSource', 'dateApplied', 'status', 'date'];
const historyFields = ['status', 'interviewStage', 'date', 'notes', 'scheduledTime', 'deadline'];
const own = (object, key) => Object.hasOwn(object, key);
export function jobError(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function id(value) {
  if (!mongoose.isValidObjectId(value)) jobError('Invalid record ID');
}
function payload(data, allowed) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) jobError('Expected an object');
  if (Object.keys(data).some((key) => !allowed.includes(key))) jobError('Unsupported or protected field');
}
function text(value, field, max, required = false) {
  if (typeof value !== 'string') jobError(`Invalid ${field}`);
  const result = value.trim();
  if (result.length > max || (required && !result)) jobError(`Invalid ${field}`);
  return result;
}
function status(value) {
  if (!STATUSES.includes(value)) jobError('Invalid application status');
  return value;
}
function date(value, field, optional = false) {
  if (optional && (value === '' || value === null)) return null;
  const timestamp = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = parseEmailDate(timestamp);
  if (!parsed) jobError(`Invalid ${field}`);
  return parsed;
}
function jobData(data) {
  payload(data, jobFields);
  const result = {};
  for (const field of ['company', 'position', 'location', 'notes', 'applicationSource']) {
    if (own(data, field)) result[field] = text(data[field], field, field === 'notes' ? 10000 : 200, ['company', 'position'].includes(field));
  }
  if (own(data, 'jobUrl')) {
    result.jobUrl = text(data.jobUrl, 'job URL', 2048);
    if (result.jobUrl) {
      let url;
      try { url = new URL(result.jobUrl); } catch { jobError('Job URL must be a complete http or https URL'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) jobError('Job URL must be a complete http or https URL');
    }
  }
  if (own(data, 'status')) result.status = status(data.status);
  for (const field of ['dateApplied', 'date']) if (own(data, field)) result[field] = date(data[field], field);
  return result;
}
function historyData(data, partial = false) {
  payload(data, historyFields);
  const result = {};
  if (!partial || own(data, 'status')) result.status = status(data.status);
  if (own(data, 'date')) result.date = date(data.date, 'date');
  else if (!partial) result.date = new Date();
  for (const field of ['notes', 'interviewStage']) {
    if (own(data, field)) result[field] = text(data[field], field, field === 'notes' ? 10000 : 200);
  }
  for (const field of ['scheduledTime', 'deadline']) if (own(data, field)) result[field] = date(data[field], field, true);
  return result;
}

async function ownedJob(userId, jobId, session) {
  id(userId); id(jobId);
  const query = Job.findOne({ _id: jobId, userId });
  if (session) query.session(session);
  const job = await query;
  if (!job) jobError('Application not found', 404);
  return job;
}
// Share the same per-user transaction lock with email matching/writes. Metadata
// edits, manual status actions and email processing cannot commit stale snapshots.
async function mutate(userId, operation) {
  id(userId);
  return mongoose.connection.transaction(async (session) => {
    const owner = await User.updateOne({ _id: userId }, { $inc: { mailEventVersion: 1 } }, { session });
    if (!owner.matchedCount) jobError('User not found', 404);
    return operation(session);
  }, { writeConcern: { w: 'majority' } });
}
export { mutate as withUserMutation };
function protectManualState(job) {
  job.lastStatusEventAt = new Date(Math.max(Date.now(), job.lastStatusEventAt?.getTime() || 0));
}
async function recomputeStatus(job, session) {
  // History-only emails never become current through an edit or deletion.
  const latest = await StatusHistory.findOne({
    jobId: job._id, userId: job.userId, deletedAt: null, statusApplied: { $ne: false },
  }).sort({ date: -1, createdAt: -1, _id: -1 }).session(session);
  job.status = latest?.status || 'applied';
  protectManualState(job);
  await job.save({ session });
}

export async function getJob(userId, jobId) { return ownedJob(userId, jobId); }
export async function archiveJob(userId, jobId, archived) {
  return mutate(userId, async (session) => {
    const job = await ownedJob(userId, jobId, session);
    job.archivedAt = archived ? (job.archivedAt || new Date()) : null;
    await job.save({ session });
    return { job };
  });
}
export async function listHistory(userId, jobId) {
  await ownedJob(userId, jobId);
  return StatusHistory.find({ jobId, userId, deletedAt: null }).sort({ date: 1, createdAt: 1, _id: 1 });
}
export async function createJob(userId, data) {
  const fields = jobData(data);
  if (!fields.company || !fields.position) jobError('Company and position are required');
  delete fields.date;
  return mutate(userId, async (session) => {
    const [job] = await Job.create([{ ...fields, userId, lastStatusEventAt: new Date() }], { session });
    await StatusHistory.create([{
      userId, jobId: job._id, status: job.status, date: job.dateApplied,
      notes: 'Initial application', statusApplied: true,
    }], { session });
    return { job };
  });
}
export async function updateJob(userId, jobId, data, { requireStatus = false } = {}) {
  id(jobId);
  const fields = jobData(data);
  return mutate(userId, async (session) => {
    const job = await ownedJob(userId, jobId, session);
    const changedStatus = own(fields, 'status') && fields.status !== job.status;
    const { date: eventDate, status: nextStatus, ...metadata } = fields;
    Object.assign(job, metadata);
    if (changedStatus) {
      await StatusHistory.create([{
        userId, jobId, status: nextStatus, date: eventDate || new Date(),
        notes: '', statusApplied: true,
      }], { session });
      await recomputeStatus(job, session);
      if (requireStatus && job.status !== nextStatus) jobError('A newer history determines the current status. Review the timeline before retrying.', 409);
    } else await job.save({ session });
    return { job };
  });
}
export async function addHistory(userId, jobId, data) {
  id(jobId);
  const fields = historyData(data);
  return mutate(userId, async (session) => {
    const job = await ownedJob(userId, jobId, session);
    if (fields.status !== 'interviewing') fields.interviewStage = '';
    const [entry] = await StatusHistory.create([{ ...fields, userId, jobId, statusApplied: true }], { session });
    await recomputeStatus(job, session);
    return { statusHistory: entry, job };
  });
}
export async function changeHistory(userId, jobId, statusId, data, remove = false) {
  id(jobId); id(statusId);
  const fields = remove ? {} : historyData(data, true);
  return mutate(userId, async (session) => {
    const job = await ownedJob(userId, jobId, session);
    const entry = await StatusHistory.findOne({ _id: statusId, userId, jobId, deletedAt: null }).session(session);
    if (!entry) jobError('Status history entry not found', 404);
    const affectsState = entry.statusApplied !== false && (remove
      || (own(fields, 'status') && fields.status !== entry.status)
      || (own(fields, 'date') && fields.date.getTime() !== entry.date.getTime()));
    if (remove) entry.deletedAt = new Date();
    else {
      for (const [field, kind] of [['scheduledTime', 'appointment'], ['deadline', 'deadline']]) {
        if (own(fields, field) && (fields[field]?.getTime() ?? null) !== (entry[field]?.getTime() ?? null)) {
          // A -> B -> A must be a new occurrence, not a previously read reminder.
          entry.set(`reminderRevision.${kind}`, (entry.get(`reminderRevision.${kind}`) || 0) + 1);
          entry.set(`reminderState.${kind}`, undefined);
        }
      }
      Object.assign(entry, fields);
      if (entry.status !== 'interviewing') entry.interviewStage = '';
    }
    await entry.save({ session });
    if (affectsState) await recomputeStatus(job, session);
    return remove ? { success: true, job } : { statusHistory: entry, job };
  });
}
export async function deleteJob(userId, jobId) {
  return mutate(userId, async (session) => {
    await ownedJob(userId, jobId, session);
    await StatusHistory.deleteMany({ userId, jobId }, { session });
    await Job.deleteOne({ _id: jobId, userId }, { session });
    return { success: true };
  });
}
