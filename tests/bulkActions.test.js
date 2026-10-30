import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import PendingItem from '../lib/models/PendingItem.js';
import { createJob, addHistory } from '../lib/jobs/jobMutations.js';
import { bulkJobs, bulkPending } from '../lib/jobs/bulkActions.js';
import { listSchedule } from '../lib/schedule/listSchedule.js';
import { listReminders, actOnReminder } from '../lib/reminders/reminders.js';
import { createJobRoute, readJobBody } from '../lib/jobs/routeHandler.js';

let replica, owner, other;
const models = [User, Job, StatusHistory, PendingItem];
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri()); await Promise.all(models.map((m) => m.init()));
});
after(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
beforeEach(async () => {
  await Promise.all(models.map((m) => m.deleteMany({})));
  owner = await User.create({ email: 'batch@example.test', password: 'test-only' });
  other = await User.create({ email: 'other@example.test', password: 'test-only' });
});
const makeJob = async (user = owner) => (await createJob(user._id, { company: 'Acme', position: 'Engineer' })).job;
const mail = async (job, overrides = {}) => PendingItem.create({ userId: owner._id, accountId: new mongoose.Types.ObjectId(),
  provider: 'gmail', messageId: String(new mongoose.Types.ObjectId()), company: 'Acme', position: 'Engineer',
  eventType: 'interview', receivedAt: new Date(), targetJobId: job?._id, ...overrides });
const ids = (...records) => records.map((r) => String(r._id));

test('archive and restore preserve state/history, suppress schedules and reject stale reminder actions', async () => {
  const job = await makeJob();
  const time = new Date(Date.now() + 30 * 60000);
  await addHistory(owner._id, job._id, { status: 'interviewing', scheduledTime: time.toISOString() });
  const before = await listReminders(owner._id); assert.equal(before.reminders.length, 1);
  const result = await bulkJobs(owner._id, { ids: ids(job), action: 'archive' });
  assert.equal(result.succeeded, 1); assert.ok(result.results[0].job.archivedAt);
  assert.equal((await listSchedule(owner._id)).length, 0);
  assert.equal((await listReminders(owner._id)).unreadCount, 0);
  const reminder = before.reminders[0];
  await assert.rejects(actOnReminder(owner._id, { historyId: reminder.historyId, kind: reminder.kind, revision: reminder.revision, action: 'read' }), (e) => e.status === 409);
  const repeat = await bulkJobs(owner._id, { ids: ids(job), action: 'archive' });
  assert.equal(+repeat.results[0].job.archivedAt, +result.results[0].job.archivedAt);
  await bulkJobs(owner._id, { ids: ids(job), action: 'restore' });
  assert.equal((await listSchedule(owner._id)).length, 1);
  assert.equal(await StatusHistory.countDocuments({ jobId: job._id }), 2);
  assert.equal((await Job.findById(job._id)).status, 'interviewing');
});
test('status changes are atomic per item, deduplicated and safe to repeat concurrently', async () => {
  const a = await makeJob(), b = await makeJob(), foreign = await makeJob(other);
  const payload = { ids: [...ids(a, b, foreign), String(a._id), String(new mongoose.Types.ObjectId())], action: 'status', status: 'offer' };
  const results = await Promise.all([bulkJobs(owner._id, payload), bulkJobs(owner._id, payload)]);
  for (const r of results) { assert.equal(r.total, 4); assert.equal(r.succeeded, 2); assert.equal(r.failed, 2); }
  for (const job of [a, b]) { assert.equal((await Job.findById(job._id)).status, 'offer'); assert.equal(await StatusHistory.countDocuments({ jobId: job._id }), 2); }
  assert.equal((await Job.findById(foreign._id)).status, 'applied');
});
test('future history conflicts roll back bulk status changes instead of claiming success or adding duplicate history', async () => {
  const job = await makeJob();
  await addHistory(owner._id, job._id, { status: 'interviewing', date: new Date(Date.now() + 86400000).toISOString() });
  for (let i = 0; i < 2; i++) {
    const r = await bulkJobs(owner._id, { ids: ids(job), action: 'status', status: 'offer' });
    assert.equal(r.failed, 1); assert.equal(r.results[0].status, 409);
  }
  assert.equal(await StatusHistory.countDocuments({ jobId: job._id }), 2);
  assert.equal((await Job.findById(job._id)).status, 'interviewing');
});
test('invalid batch envelopes fail before any record is changed', async () => {
  const job = await makeJob();
  for (const body of [null, {}, { ids: [], action: 'archive' }, { ids: Array(51).fill(String(job._id)), action: 'archive' },
    { ids: [...ids(job), 'bad'], action: 'archive' }, { ids: ids(job), action: 'status', status: 'hired' },
    { ids: ids(job), action: 'archive', userId: String(other._id) }, { ids: ids(job), action: 'delete' }]) {
    await assert.rejects(bulkJobs(owner._id, body), (e) => e.status === 400);
  }
  assert.equal((await Job.findById(job._id)).archivedAt, null);
});
test('batch review keeps unresolved and foreign emails pending; repeated acceptance never duplicates history', async () => {
  const job = await makeJob();
  const good = await mail(job), unresolved = await mail(null), foreign = await mail(job, { userId: other._id });
  const payload = { ids: ids(good, unresolved, foreign), action: 'accept' };
  for (let i = 0; i < 2; i++) {
    const r = await bulkPending(owner._id, payload);
    assert.equal(r.succeeded, 1); assert.equal(r.failed, 2);
    assert.equal(r.results[1].status, 409); assert.equal(r.results[2].status, 404);
  }
  assert.equal(await StatusHistory.countDocuments({ jobId: job._id }), 2);
  assert.equal((await PendingItem.findById(unresolved._id)).status, 'pending');
  assert.equal((await PendingItem.findById(foreign._id)).status, 'pending');
});
test('per-email updates apply to the right target; malformed fields stay pending', async () => {
  const job = await makeJob(), a = await mail(null), b = await mail(null), c = await mail(job);
  const r = await bulkPending(owner._id, { ids: ids(a, b, c), action: 'accept', updates: {
    [a._id]: { targetJobId: String(job._id), eventType: 'offer' },
    [b._id]: { targetJobId: null, createNew: true, company: 'New company', position: 'Designer' },
    [c._id]: { userId: String(other._id) },
  } });
  assert.equal(r.succeeded, 2); assert.equal(r.failed, 1);
  assert.equal(await Job.countDocuments({ userId: owner._id }), 2);
  assert.equal((await PendingItem.findById(c._id)).status, 'pending');
});
test('ignore is repeatable and cannot overwrite an accepted review', async () => {
  const job = await makeJob(), a = await mail(job), b = await mail(job);
  await bulkPending(owner._id, { ids: ids(a), action: 'accept' });
  for (let i = 0; i < 2; i++) {
    const r = await bulkPending(owner._id, { ids: ids(a, b), action: 'ignore' });
    assert.equal(r.succeeded, 1); assert.equal(r.failed, 1); assert.equal(r.results[0].status, 409);
  }
  assert.equal(await StatusHistory.countDocuments({ jobId: job._id }), 2);
});
test('bulk route authenticates before connecting and rejects malformed JSON', async () => {
  let connected = false;
  const denied = createJobRoute(() => { throw Error('must not run'); }, { authenticate: async () => null, connect: async () => { connected = true; } });
  assert.equal((await denied(new Request('http://localhost/api/jobs/bulk', { method: 'POST' }))).status, 401); assert.equal(connected, false);
  const route = createJobRoute(async ({ request, userId }) => bulkJobs(userId, await readJobBody(request)), { authenticate: async () => String(owner._id), connect: async () => {} });
  assert.equal((await route(new Request('http://localhost/api/jobs/bulk', { method: 'POST', body: '{' }))).status, 400);
});
