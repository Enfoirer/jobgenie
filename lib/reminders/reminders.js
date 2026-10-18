import mongoose from 'mongoose';
import User from '../models/User.js';
import Job from '../models/Job.js';
import StatusHistory from '../models/StatusHistory.js';
import { jobError, withUserMutation } from '../jobs/jobMutations.js';
import { listSchedule } from '../schedule/listSchedule.js';
import { projectSchedule } from '../schedule/events.js';
import { LEAD_MINUTES, SNOOZE_MINUTES, reminderSettings, projectReminder } from './policy.js';

function validateBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !allowed.includes(key))) jobError('Invalid reminder request');
}
export async function listReminders(userId, now = Date.now()) {
  if (!mongoose.isValidObjectId(userId)) jobError('Invalid user ID');
  const [user, events] = await Promise.all([User.findById(userId).select('reminderSettings').lean(), listSchedule(userId)]);
  if (!user) jobError('User not found', 404);
  const settings = reminderSettings(user);
  const reminders = events.map((event) => projectReminder(event, settings, now)).filter(Boolean);
  return { settings, reminders, unreadCount: reminders.filter((item) => item.status === 'unread').length, serverTime: new Date(now).toISOString() };
}

export async function saveReminderSettings(userId, body) {
  validateBody(body, ['enabled', 'leadMinutes']);
  if (!Object.keys(body).length || (Object.hasOwn(body, 'enabled') && typeof body.enabled !== 'boolean')
    || (Object.hasOwn(body, 'leadMinutes') && !LEAD_MINUTES.includes(body.leadMinutes))) jobError('Choose a valid reminder setting');
  return withUserMutation(userId, async (session) => {
    const fields = Object.fromEntries(Object.entries(body).map(([key, value]) => [`reminderSettings.${key}`, value]));
    const user = await User.findByIdAndUpdate(userId, { $set: fields }, { new: true, session }).lean();
    return { settings: reminderSettings(user) };
  });
}

export async function actOnReminder(userId, body, now = Date.now()) {
  validateBody(body, ['historyId', 'kind', 'revision', 'action']);
  const { historyId, kind, revision, action } = body;
  if (!mongoose.isValidObjectId(historyId) || !['appointment', 'deadline'].includes(kind)
    || !Number.isSafeInteger(revision) || revision < 0 || !['read', 'snooze', 'cancel'].includes(action)) jobError('Invalid reminder action');
  return withUserMutation(userId, async (session) => {
    const entry = await StatusHistory.findOne({ _id: historyId, userId, deletedAt: null }).session(session);
    if (!entry) jobError('Reminder not found', 404);
    const job = await Job.findOne({ _id: entry.jobId, userId }).session(session).lean();
    if (!job) jobError('Reminder not found', 404);
    if ((entry.get(`reminderRevision.${kind}`) || 0) !== revision) jobError('This schedule changed. Refresh your reminders.', 409);
    const user = await User.findById(userId).session(session).lean();
    const event = projectSchedule(entry.toObject(), job).find((item) => item.kind === kind);
    const reminder = event && projectReminder(event, reminderSettings(user), now);
    if (!reminder) jobError('This reminder is no longer active. Refresh your reminders.', 409);
    // Terminal actions are idempotent. A stale tab cannot undo a read/cancel with
    // snooze, and repeating an in-flight snooze does not extend its due time.
    if (action === 'snooze') {
      if (['read', 'cancelled'].includes(reminder.status)) jobError('This reminder was already handled. Refresh your reminders.', 409);
      if (reminder.status === 'snoozed') return { success: true };
      if (!reminder.canSnooze) jobError('Less than 10 minutes remain. Mark read or cancel instead.');
    }
    if (reminder.status === 'cancelled' || (action === 'read' && reminder.status === 'read')) return { success: true };
    entry.set(`reminderState.${kind}`, {
      status: { read: 'read', snooze: 'snoozed', cancel: 'cancelled' }[action], updatedAt: new Date(now),
      ...(action === 'snooze' && { snoozedUntil: new Date(now + SNOOZE_MINUTES * 60000) }),
    });
    await entry.save({ session });
    return { success: true };
  });
}
