import { randomUUID } from 'node:crypto';
import PushDevice from '../models/PushDevice.js';
import PushDelivery from '../models/PushDelivery.js';
import PushWorker from '../models/PushWorker.js';
import StatusHistory from '../models/StatusHistory.js';
import Job from '../models/Job.js';
import User from '../models/User.js';
import { withUserMutation, jobError } from '../jobs/jobMutations.js';
import { listReminders } from '../reminders/reminders.js';
import { projectReminder, reminderSettings } from '../reminders/policy.js';
import { projectSchedule } from '../schedule/events.js';
import { hash, deviceInput } from './devices.js';
import { sendAPNs } from './apns.js';

async function liveOccurrence(device, reference, now, session) {
  const query = model => session ? model.session(session) : model;
  const current = await query(PushDevice.findOne({ _id: device._id, bindingId: device.bindingId, active: true,
    expiresAt: { $gt: new Date(now) } }).select('+token')).lean();
  if (!current || String(current.userId) !== String(device.userId)) return null;
  const user = await query(User.findById(current.userId)).lean();
  if (!user || (user.authVersion || 0) !== current.authVersion) return null;
  const entry = await query(StatusHistory.findOne({ _id: reference.historyId, userId: current.userId, deletedAt: null })).lean();
  if (!entry) return null;
  const job = await query(Job.findOne({ _id: entry.jobId, userId: current.userId })).lean();
  const event = projectSchedule(entry, job).find(item => item.kind === reference.kind);
  const reminder = event && projectReminder(event, reminderSettings(user), now);
  if (!reminder || reminder.status !== 'unread' || reminder.revision !== reference.revision) return null;
  const saved = entry.reminderState?.[reference.kind];
  const phase = saved?.status === 'snoozed' && saved.snoozedUntil ? new Date(saved.snoozedUntil).toISOString() : 'initial';
  return { device: current, reminder, phase };
}
async function reserve(device, item, clock) {
  return withUserMutation(device.userId, async session => {
    const now = clock();
    const live = await liveOccurrence(device, item, now, session);
    if (!live) return null;
    // Stable across token refresh, locale updates and logout/relogin. Explicit
    // snoozes get their own phase; changes of scheduled time get a new revision.
    const id = hash(`${device._id}:${device.userId}:${live.reminder.id}:${live.phase}`);
    const existing = await PushDelivery.findById(id).session(session).lean();
    if (existing && (existing.status !== 'retry' || existing.retryAt > new Date(now) || existing.attempts >= 3)) return null;
    const delivery = { _id: id, deviceId: device._id, bindingId: device.bindingId, userId: device.userId,
      historyId: item.historyId, kind: item.kind, revision: item.revision, phase: live.phase,
      status: 'sending', attempts: (existing?.attempts || 0) + 1, expiresAt: new Date(live.reminder.time), updatedAt: new Date(now) };
    await PushDelivery.findOneAndUpdate({ _id: id }, { $set: delivery, $unset: { retryAt: '' } }, { upsert: true, session });
    return { ...live, delivery };
  });
}
export async function resolveNotification(identity, body, now = Date.now()) {
  const id = deviceInput(body, ['installationKey', 'sequence', 'deliveryId']);
  if (!/^[a-f0-9]{64}$/.test(body.deliveryId || '')) jobError('Invalid notification');
  const device = await PushDevice.findOne({ _id: id, userId: identity.userId, active: true, sessionId: hash(identity.sessionId) }).lean();
  const delivery = device && await PushDelivery.findOne({ _id: body.deliveryId, deviceId: id, userId: identity.userId,
    bindingId: device.bindingId, status: { $in: ['sent', 'sending'] } }).lean();
  const live = delivery && await liveOccurrence(device, delivery, now);
  if (!live || live.phase !== delivery.phase) jobError('This reminder is no longer active.', 409);
  return { jobId: live.reminder.jobId };
}
export async function runPushWorker({ config, send = sendAPNs, clock = Date.now, maxDevices = 20, maxSends = 30, budgetMs = 40000 } = {}) {
  if (!config) jobError('System notifications are not configured.', 503);
  const started = clock(), owner = randomUUID();
  let lease;
  try {
    lease = await PushWorker.findOneAndUpdate({ _id: 'reminders', $or: [{ leaseUntil: { $lte: new Date(started) } }, { leaseUntil: null }] },
      { $set: { owner, leaseUntil: new Date(started + 120000) } }, { upsert: true, new: true }).lean();
  } catch (error) { if (error.code === 11000) return { busy: true }; throw error; }
  const counts = { devices: 0, attempted: 0, sent: 0, retry: 0, rejected: 0, unknown: 0, cancelled: 0 };
  try {
    // A process crash after a send claim has an unknown outcome; never replay it.
    await PushDelivery.updateMany({ status: 'sending', updatedAt: { $lt: new Date(started - 120000) } }, { $set: { status: 'unknown' } });
    const filter = { active: true, expiresAt: { $gt: new Date(started) }, environment: { $in: config.environments } };
    let devices = await PushDevice.find({ ...filter, ...(lease.cursor && { _id: { $gt: lease.cursor } }) }).sort({ _id: 1 }).limit(maxDevices).lean();
    if (!devices.length && lease.cursor) devices = await PushDevice.find(filter).sort({ _id: 1 }).limit(maxDevices).lean();
    for (const device of devices) {
      if (clock() - started >= budgetMs || counts.attempted >= maxSends) break;
      const user = await User.findById(device.userId).select('authVersion').lean();
      if (!user || (user.authVersion || 0) !== device.authVersion) {
        await PushDevice.updateOne({ _id: device._id, bindingId: device.bindingId }, { $set: { active: false } });
      } else {
        const response = await listReminders(device.userId, clock());
        let complete = true;
        for (const item of response.reminders.filter(item => item.status === 'unread')) {
          if (clock() - started >= budgetMs || counts.attempted >= maxSends) { complete = false; break; }
          const claim = await reserve(device, item, clock);
          if (!claim) continue;
          // Re-read after the reservation transaction and immediately before IO.
          const live = await liveOccurrence(claim.device, claim.delivery, clock());
          if (!live || live.phase !== claim.delivery.phase) {
            await PushDelivery.updateOne({ _id: claim.delivery._id }, { $set: { status: 'cancelled', updatedAt: new Date(clock()) } });
            counts.cancelled++; continue;
          }
          counts.attempted++;
          let result;
          try { result = await send(config, live.device, claim.delivery, live.reminder); }
          catch { result = { status: 'unknown' }; }
          if (!['sent', 'retry', 'rejected', 'unknown'].includes(result?.status)) result = { status: 'unknown' };
          const stillLive = await liveOccurrence(live.device, claim.delivery, clock());
          const status = stillLive && stillLive.phase === claim.delivery.phase ? result.status : 'cancelled';
          await PushDelivery.updateOne({ _id: claim.delivery._id, status: 'sending' }, { $set: { status, updatedAt: new Date(clock()),
            ...(status === 'retry' && { retryAt: new Date(clock() + 60000 * claim.delivery.attempts) }) } });
          counts[status]++;
          if (result.invalidateDevice) await PushDevice.updateOne({ _id: device._id, bindingId: device.bindingId, tokenHash: live.device.tokenHash }, { $set: { active: false } });
        }
        if (!complete) break;
      }
      counts.devices++;
      await PushWorker.updateOne({ _id: 'reminders', owner }, { $set: { cursor: device._id } });
    }
    return counts;
  } finally {
    await PushWorker.updateOne({ _id: 'reminders', owner }, { $set: { leaseUntil: new Date(0) }, $unset: { owner: '' } });
  }
}
