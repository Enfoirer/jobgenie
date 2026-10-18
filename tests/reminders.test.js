import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import { createJob, addHistory, changeHistory, updateJob, deleteJob } from '../lib/jobs/jobMutations.js';
import { createJobRoute, readJobBody } from '../lib/jobs/routeHandler.js';
import { listReminders, saveReminderSettings, actOnReminder } from '../lib/reminders/reminders.js';
import { listSchedule } from '../lib/schedule/listSchedule.js';

const now = Date.parse('2030-10-20T10:00:00Z');
const at = (minutes) => new Date(now + minutes * 60000).toISOString();
const hasStatus = (status) => (error) => error.status === status;
let replica, user, other, job;
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User.init(), Job.init(), StatusHistory.init()]);
});
after(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Job.deleteMany({}), StatusHistory.deleteMany({})]);
  user = await User.create({ email: 'reminders@example.test', password: 'test-only' });
  other = await User.create({ email: 'other@example.test', password: 'test-only' });
  ({ job } = await createJob(user._id, { company: 'Acme', position: 'Engineer', dateApplied: '2020-01-01' }));
});
const add = async (fields = {}) => (await addHistory(user._id, job._id, { status: 'interviewing', date: '2020-02-01', scheduledTime: at(30), ...fields })).statusHistory;
const list = (clock = now) => listReminders(user._id, clock);
const action = (entry, type, kind = 'appointment', revision = 0, clock = now) => actOnReminder(user._id, {
  historyId: String(entry._id), kind, revision, action: type,
}, clock);

test('legacy preferences default to enabled with a one-hour lead time', async () => {
  await User.collection.updateOne({ _id: user._id }, { $unset: { reminderSettings: '' } });
  await add();
  const result = await list();
  assert.deepEqual(result.settings, { enabled: true, leadMinutes: 60 });
  assert.equal(result.unreadCount, 1);
});
test('reminders open at the lead-time boundary and expire at the scheduled instant', async () => {
  await add({ scheduledTime: at(60) });
  assert.equal((await list(now - 1)).unreadCount, 0);
  assert.equal((await list()).unreadCount, 1);
  assert.equal((await list(now + 60 * 60000 - 1)).unreadCount, 1);
  assert.equal((await list(now + 60 * 60000)).reminders.length, 0);
});
test('missing, expired and far-future times do not become reminders', async () => {
  await add({ scheduledTime: null });
  await add({ scheduledTime: at(-1) });
  await add({ scheduledTime: at(61) });
  assert.deepEqual((await list()).reminders, []);
});
test('an appointment and assessment deadline have independent stable reminders', async () => {
  const entry = await add({ deadline: at(40), interviewStage: 'Online Assessment' });
  assert.equal((await list()).unreadCount, 2);
  await action(entry, 'read');
  const result = await list();
  assert.equal(result.unreadCount, 1);
  assert.equal(result.reminders.find((item) => item.kind === 'deadline').status, 'unread');
});
test('repeated and concurrent reads never create delivery rows or duplicate reminders', async () => {
  await add();
  const version = (await User.findById(user._id)).mailEventVersion;
  const before = await StatusHistory.find({}).lean();
  const results = await Promise.all([list(), list(), list()]);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
  assert.deepEqual(await StatusHistory.find({}).lean(), before);
  assert.equal((await User.findById(user._id)).mailEventVersion, version);
});
test('read survives fresh reads, repeat requests and preference changes without becoming unread', async () => {
  const entry = await add();
  await action(entry, 'read');
  await action(entry, 'read', 'appointment', 0, now + 1000);
  await saveReminderSettings(user._id, { enabled: false });
  assert.equal((await list()).reminders.length, 0);
  await saveReminderSettings(user._id, { enabled: true, leadMinutes: 1440 });
  assert.equal((await list()).unreadCount, 0);
  assert.equal((await list()).reminders[0].status, 'read');
  assert.equal((await StatusHistory.findById(entry._id)).reminderState.appointment.updatedAt.getTime(), now);
});
test('snooze returns once after 10 minutes, and retrying it does not extend the delay', async () => {
  const entry = await add();
  await action(entry, 'snooze');
  await action(entry, 'snooze', 'appointment', 0, now + 60000);
  assert.equal((await list()).unreadCount, 0);
  assert.equal((await list()).reminders[0].snoozedUntil, at(10));
  assert.equal((await list(now + 10 * 60000 - 1)).unreadCount, 0);
  assert.equal((await list(now + 10 * 60000)).unreadCount, 1);
  await action(entry, 'read', 'appointment', 0, now + 10 * 60000);
  assert.equal((await list(now + 15 * 60000)).unreadCount, 0);
});
test('snooze is rejected when it would reach or exceed the appointment', async () => {
  const entry = await add({ scheduledTime: at(10) });
  assert.equal((await list()).reminders[0].canSnooze, false);
  await assert.rejects(action(entry, 'snooze'), hasStatus(400));
  assert.equal((await list()).unreadCount, 1);
});
test('cancel is persistent and stale read/snooze cannot reactivate it', async () => {
  const entry = await add();
  await action(entry, 'cancel');
  await action(entry, 'cancel');
  await action(entry, 'read');
  await assert.rejects(action(entry, 'snooze'), hasStatus(409));
  assert.equal((await list()).reminders[0].status, 'cancelled');
  assert.equal((await list()).unreadCount, 0);
  assert.equal((await listSchedule(user._id)).length, 1);
});
test('reschedule cancels old actions and A-to-B-to-A creates a genuinely new occurrence', async () => {
  const entry = await add();
  await action(entry, 'read');
  const firstId = (await list()).reminders[0].id;
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(40) });
  await assert.rejects(action(entry, 'read'), hasStatus(409));
  assert.equal((await list()).reminders[0].revision, 1);
  assert.equal((await list()).unreadCount, 1);
  await action(entry, 'cancel', 'appointment', 1);
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(30) });
  const result = await list();
  assert.equal(result.reminders[0].revision, 2);
  assert.notEqual(result.reminders[0].id, firstId);
  assert.equal(result.unreadCount, 1);
});
test('notes and equivalent timestamps preserve read state; moving one field does not reset the other', async () => {
  const entry = await add({ deadline: at(40) });
  await action(entry, 'read'); await action(entry, 'cancel', 'deadline');
  await changeHistory(user._id, job._id, entry._id, { notes: 'Updated', scheduledTime: '2030-10-20T18:30:00+08:00' });
  assert.equal((await list()).unreadCount, 0);
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(35) });
  const result = await list();
  assert.equal(result.unreadCount, 1);
  assert.equal(result.reminders.find((item) => item.kind === 'deadline').status, 'cancelled');
});
test('clearing a time removes its reminder and rejects stale actions', async () => {
  const entry = await add();
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: null });
  assert.equal((await list()).reminders.length, 0);
  await assert.rejects(action(entry, 'read'), hasStatus(409));
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(30) });
  assert.equal((await list()).reminders[0].revision, 2);
});
test('deleted history and application cannot leave an orphan reminder', async () => {
  const entry = await add();
  await changeHistory(user._id, job._id, entry._id, null, true);
  assert.equal((await list()).reminders.length, 0);
  await assert.rejects(action(entry, 'read'), hasStatus(404));
  const next = await add();
  await deleteJob(user._id, job._id);
  assert.equal((await list()).reminders.length, 0);
  await assert.rejects(action(next, 'read'), hasStatus(404));
});
test('Offer/Rejected stops reminders while preserving the calendar and reopening respects handled state', async () => {
  const entry = await add();
  await action(entry, 'read');
  for (const status of ['offer', 'rejected']) {
    await updateJob(user._id, job._id, { status });
    assert.equal((await list()).reminders.length, 0);
    assert.equal((await listSchedule(user._id)).length, 1);
    await assert.rejects(action(entry, 'read'), hasStatus(409));
  }
  await updateJob(user._id, job._id, { status: 'interviewing' });
  assert.equal((await list()).reminders[0].status, 'read');
});
test('expired and disabled reminders reject actions even from a previously open tab', async () => {
  const entry = await add();
  await assert.rejects(action(entry, 'read', 'appointment', 0, now + 30 * 60000), hasStatus(409));
  await saveReminderSettings(user._id, { enabled: false });
  await assert.rejects(action(entry, 'read'), hasStatus(409));
});
test('lead settings persist, widen/narrow the window, and reject invalid/protected input', async () => {
  await add({ scheduledTime: at(120) });
  assert.equal((await list()).unreadCount, 0);
  await saveReminderSettings(user._id, { leadMinutes: 1440 });
  assert.equal((await list()).unreadCount, 1);
  await saveReminderSettings(user._id, { leadMinutes: 15 });
  assert.equal((await list()).unreadCount, 0);
  for (const body of [{ leadMinutes: '60' }, { leadMinutes: 16 }, { leadMinutes: 0 }, { enabled: 'false' }, { userId: other._id }, {}, [], null]) {
    await assert.rejects(saveReminderSettings(user._id, body), hasStatus(400));
  }
});
test('reminder actions validate all fields and cannot write hidden state through history editing', async () => {
  const entry = await add();
  const valid = { historyId: String(entry._id), kind: 'appointment', revision: 0, action: 'read' };
  for (const body of [null, [], {}, { ...valid, kind: '$set' }, { ...valid, revision: -1 }, { ...valid, revision: '0' }, { ...valid, action: 'unread' }, { ...valid, userId: other._id }]) {
    await assert.rejects(actOnReminder(user._id, body, now), hasStatus(400));
  }
  for (const body of [{ reminderRevision: { appointment: 0 } }, { reminderState: { appointment: { status: 'read' } } }]) {
    await assert.rejects(changeHistory(user._id, job._id, entry._id, body), hasStatus(400));
  }
});
test('another user cannot see or act on a reminder, including mismatched parent ownership', async () => {
  const entry = await add();
  const body = { historyId: String(entry._id), kind: 'appointment', revision: 0, action: 'read' };
  assert.equal((await listReminders(other._id, now)).reminders.length, 0);
  await assert.rejects(actOnReminder(other._id, body, now), hasStatus(404));
  await StatusHistory.updateOne({ _id: entry._id }, { $set: { userId: other._id } });
  assert.equal((await listReminders(other._id, now)).reminders.length, 0);
  await assert.rejects(actOnReminder(other._id, body, now), hasStatus(404));
});
test('concurrent read/snooze cannot re-open a handled reminder', async () => {
  const entry = await add();
  await Promise.allSettled([action(entry, 'read'), action(entry, 'snooze')]);
  assert.equal((await list()).reminders[0].status, 'read');
});
test('concurrent reschedule and old read preserve the new occurrence as unread', async () => {
  const entry = await add();
  const outcomes = await Promise.allSettled([
    changeHistory(user._id, job._id, entry._id, { scheduledTime: at(40) }), action(entry, 'read'),
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal((await list()).reminders[0].revision, 1);
  assert.equal((await list()).unreadCount, 1);
});
test('failed reminder write rolls back and can be retried without changing job/history ordering', async (t) => {
  const entry = await add();
  const initialJob = await Job.findById(job._id).lean();
  const patch = t.mock.method(StatusHistory.prototype, 'save', async () => { throw new Error('write failed'); });
  await assert.rejects(action(entry, 'read'), /write failed/);
  patch.mock.restore();
  assert.equal((await list()).unreadCount, 1);
  await action(entry, 'read');
  assert.deepEqual(await Job.findById(job._id).lean(), initialJob);
  assert.equal((await StatusHistory.findById(entry._id)).date.getTime(), entry.date.getTime());
});
test('reminder API adapter rejects unauthenticated access before DB work and malformed JSON', async () => {
  let connected = false;
  const anonymous = createJobRoute(() => {}, { authenticate: async () => null, connect: async () => { connected = true; } });
  assert.equal((await anonymous(new Request('https://example.test/api/reminders'))).status, 401);
  assert.equal(connected, false);
  const handler = createJobRoute(async ({ request, userId }) => actOnReminder(userId, await readJobBody(request), now), { authenticate: async () => user._id, connect: async () => {} });
  assert.equal((await handler(new Request('https://example.test/api/reminders', { method: 'PATCH', body: '{broken' }))).status, 400);
});
