import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import { createJob, addHistory, changeHistory, updateJob, deleteJob } from '../lib/jobs/jobMutations.js';
import { createJobRoute } from '../lib/jobs/routeHandler.js';
import { listSchedule } from '../lib/schedule/listSchedule.js';
import { projectSchedule, scheduleBucket, dayKey, monthDays } from '../lib/schedule/events.js';

const time = (day) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
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
  user = await User.create({ email: 'schedule@example.test', password: 'test-only' });
  other = await User.create({ email: 'other@example.test', password: 'test-only' });
  ({ job } = await createJob(user._id, { company: 'Acme', position: 'Engineer', dateApplied: time(1) }));
});
const add = async (fields = {}) => (await addHistory(user._id, job._id, { status: 'interviewing', date: time(2), ...fields })).statusHistory;
const list = () => listSchedule(user._id);

test('schedule uses appointment and deadline, never received or status-event dates', async () => {
  await add({ scheduledTime: time(20), deadline: time(21) });
  const events = await list();
  assert.deepEqual(events.map((event) => event.time), [time(20), time(21)]);
  assert.deepEqual(events.map((event) => event.kind), ['appointment', 'deadline']);
  assert.equal(new Date(events[0].history.date).toISOString(), time(2));
});
test('interview with no time is unscheduled even when history.date is present', async () => {
  await add();
  const [event] = await list();
  assert.equal(event.time, null);
  assert.equal(scheduleBucket(event, Date.parse(time(10))), 'unscheduled');
  assert.equal(event.label, 'Interview');
});
test('assessment requires its deadline and does not invent an interview', async () => {
  await add({ interviewStage: 'Online Assessment', deadline: time(20) });
  const events = await list();
  assert.equal(events.length, 1);
  assert.equal(events[0].label, 'Assessment deadline');
  assert.equal(events[0].time, time(20));
});
test('assessment appointment without deadline retains a separate missing-deadline task', async () => {
  await add({ interviewStage: 'Online Assessment', scheduledTime: time(20) });
  const events = await list();
  assert.deepEqual(events.map((event) => [event.label, event.time]), [
    ['Assessment appointment', time(20)], ['Assessment deadline', null],
  ]);
});
test('old email assessment with no stage uses preserved provenance; manual stage can correct it', async () => {
  const entry = await add();
  await StatusHistory.updateOne({ _id: entry._id }, { $set: { 'source.eventType': 'oa' } });
  assert.equal((await list())[0].label, 'Assessment deadline');
  await changeHistory(user._id, job._id, entry._id, { interviewStage: 'Phone Screen' });
  assert.equal((await list())[0].label, 'Interview');
});
test('applied/offer/rejected history without a schedule is absent', async () => {
  await addHistory(user._id, job._id, { status: 'offer', date: time(3) });
  await addHistory(user._id, job._id, { status: 'rejected', date: time(4) });
  assert.deepEqual(await list(), []);
});
test('terminal applications and history-only emails retain their appointments', async () => {
  const entry = await add({ scheduledTime: time(20) });
  await StatusHistory.updateOne({ _id: entry._id }, { $set: { statusApplied: false } });
  for (const status of ['offer', 'rejected']) {
    await updateJob(user._id, job._id, { status });
    const [event] = await list();
    assert.equal(event.applicationStatus, status);
    assert.equal(event.time, time(20));
    assert.equal(event.history.statusApplied, false);
  }
});
test('edits move schedules between days and queues without changing status-event ordering', async () => {
  const entry = await add();
  const before = await Job.findById(job._id);
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: '2026-10-20T09:00:00+08:00' });
  let [event] = await list();
  assert.equal(event.time, '2026-10-20T01:00:00.000Z');
  assert.equal(scheduleBucket(event, Date.parse(time(10))), 'upcoming');
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: time(5) });
  [event] = await list();
  assert.equal(scheduleBucket(event, Date.parse(time(10))), 'overdue');
  assert.equal((await Job.findById(job._id)).lastStatusEventAt.getTime(), before.lastStatusEventAt.getTime());
  assert.equal(new Date(event.history.date).toISOString(), time(2));
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: null });
  assert.equal((await list())[0].time, null);
});
test('stale AI needsScheduling flags do not hide filled or cleared schedules', async () => {
  const entry = await add({ scheduledTime: time(20) });
  await StatusHistory.updateOne({ _id: entry._id }, { $set: { needsScheduling: true } });
  assert.equal((await list())[0].time, time(20));
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: null });
  await StatusHistory.updateOne({ _id: entry._id }, { $set: { needsScheduling: false } });
  assert.equal((await list())[0].time, null);
});
test('deleting one history removes both of its schedule items without deleting another round', async () => {
  const first = await add({ scheduledTime: time(20), deadline: time(21) });
  const second = await add({ scheduledTime: time(22) });
  await changeHistory(user._id, job._id, first._id, null, true);
  const events = await list();
  assert.equal(events.length, 1);
  assert.equal(events[0].historyId, String(second._id));
  assert.equal(await StatusHistory.countDocuments({ _id: first._id }), 1);
});
test('application edits refresh event labels and application deletion removes schedule', async () => {
  await add({ scheduledTime: time(20) });
  await updateJob(user._id, job._id, { company: 'Acme Updated', position: 'Senior', location: 'Remote' });
  const [event] = await list();
  assert.equal(event.company, 'Acme Updated');
  assert.equal(event.position, 'Senior');
  assert.equal(event.location, 'Remote');
  await deleteJob(user._id, job._id);
  assert.deepEqual(await list(), []);
});
test('query excludes other users, orphaned histories and mismatched application ownership', async () => {
  await add({ scheduledTime: time(20) });
  const { job: foreign } = await createJob(other._id, { company: 'Private', position: 'Hidden' });
  await addHistory(other._id, foreign._id, { status: 'interviewing', scheduledTime: time(20) });
  await StatusHistory.create([
    { userId: user._id, jobId: foreign._id, status: 'interviewing', scheduledTime: time(20) },
    { userId: user._id, jobId: new mongoose.Types.ObjectId(), status: 'interviewing', scheduledTime: time(20) },
    { userId: other._id, jobId: job._id, status: 'interviewing', scheduledTime: time(20) },
  ]);
  assert.equal((await list()).length, 1);
  assert.equal((await list())[0].company, 'Acme');
  assert.equal((await listSchedule(other._id)).length, 1);
});
test('repeated schedule reads have stable IDs, ordering and no database writes', async () => {
  await add({ scheduledTime: time(22) });
  await add({ scheduledTime: time(20) });
  await add();
  const count = await StatusHistory.countDocuments();
  const first = await list(), second = await list();
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((event) => event.time), [time(20), time(22), null]);
  assert.equal(new Set(first.map((event) => event.id)).size, 3);
  assert.equal(await StatusHistory.countDocuments(), count);
});
test('exact-time boundary moves from upcoming to elapsed without relying on a server day', () => {
  const event = { time: time(20) }, instant = Date.parse(time(20));
  assert.equal(scheduleBucket(event, instant - 1), 'upcoming');
  assert.equal(scheduleBucket(event, instant), 'upcoming');
  assert.equal(scheduleBucket(event, instant + 1), 'overdue');
});
test('calendar keys respect local midnight and daylight-saving boundaries', () => {
  assert.equal(dayKey('2026-10-01T23:30:00Z', 'Asia/Shanghai'), '2026-10-02');
  assert.equal(dayKey('2026-10-01T23:30:00Z', 'America/Los_Angeles'), '2026-10-01');
  assert.equal(dayKey('2026-11-01T08:30:00Z', 'America/Los_Angeles'), '2026-11-01');
  assert.equal(dayKey('2026-11-01T09:30:00Z', 'America/Los_Angeles'), '2026-11-01');
  const leap = monthDays(2028, 1);
  assert.equal(leap.length, 42);
  assert.equal(new Set(leap.map((date) => dayKey(date))).size, 42);
  assert.ok(leap.some((date) => date.getMonth() === 1 && date.getDate() === 29));
  assert.equal(monthDays(2026, 11).at(-1).getFullYear(), 2027);
});
test('invalid legacy times remain unscheduled rather than becoming invalid calendar dates', () => {
  const events = projectSchedule({ _id: 'entry', status: 'interviewing', scheduledTime: 'broken', date: time(2) }, job);
  assert.equal(events.length, 1);
  assert.equal(events[0].time, null);
});
test('schedule route adapter authenticates before reading any schedule data', async () => {
  let connected = false;
  const handler = createJobRoute(async ({ userId }) => ({ events: await listSchedule(userId) }), {
    authenticate: async () => null, connect: async () => { connected = true; },
  });
  assert.equal((await handler(new Request('https://example.test/api/schedule'))).status, 401);
  assert.equal(connected, false);
});
