import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import { createJob, updateJob, getJob, deleteJob, listHistory, addHistory, changeHistory } from '../lib/jobs/jobMutations.js';
import { applyEventToJob, emailEventKey } from '../lib/pipeline/jobUpdater.js';
import { createJobRoute, readJobBody } from '../lib/jobs/routeHandler.js';

let replica, user, other;
const when = (day) => `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;
const makeJob = async (owner = user) => (await createJob(owner._id, {
  company: 'Acme', position: 'Engineer', dateApplied: when(1), notes: 'Original notes',
})).job;
const fresh = (job) => Job.findById(job._id).lean();
const histories = (job) => listHistory(user._id, job._id);
const hasStatus = (expected) => (error) => error.status === expected;
const mailEvent = (job, receivedAt = when(5)) => {
  const accountId = new mongoose.Types.ObjectId();
  return {
    userId: user._id, jobId: job._id, eventType: 'interview',
    source: { accountId, messageId: 'source-1', provider: 'gmail', receivedAt, subject: 'Interview', from: 'hr@acme.test' },
    sourceEmailKey: emailEventKey(accountId, 'source-1'), interviewTime: when(25),
  };
};
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User.init(), Job.init(), StatusHistory.init()]);
});
after(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Job.deleteMany({}), StatusHistory.deleteMany({})]);
  user = await User.create({ email: 'editor@example.test', password: 'test-only' });
  other = await User.create({ email: 'other@example.test', password: 'test-only' });
});

test('creation atomically records an initial history and an optional posting URL', async () => {
  const { job } = await createJob(user._id, { company: 'Acme', position: 'Engineer', status: 'offer', jobUrl: 'https://acme.test/jobs/1' });
  assert.equal((await fresh(job)).jobUrl, 'https://acme.test/jobs/1');
  assert.equal((await histories(job)).length, 1);
  assert.equal((await histories(job))[0].status, job.status);
});
test('editing all five details persists on a fresh read without changing current state or adding history', async () => {
  const job = await makeJob();
  const fields = { company: 'Acme Labs', position: 'Senior Engineer', location: 'Remote', notes: 'Line one\nLine two', jobUrl: 'https://acme.test/jobs/42' };
  await updateJob(user._id, job._id, fields);
  const saved = await getJob(user._id, job._id);
  for (const [key, value] of Object.entries(fields)) assert.equal(saved[key], value);
  assert.equal(saved.status, 'applied');
  assert.equal(saved.lastStatusEventAt.getTime(), job.lastStatusEventAt.getTime());
  assert.equal((await histories(job)).length, 1);
  await updateJob(user._id, job._id, { location: '', notes: '', jobUrl: '' });
  assert.equal((await fresh(job)).jobUrl, '');
});
test('invalid details and protected fields cannot change ownership or bypass validation', async () => {
  const job = await makeJob();
  for (const fields of [
    { userId: other._id }, { _id: other._id }, { lastStatusEventAt: when(30) }, { $set: { status: 'offer' } },
    { statusHistory: [] }, { company: '   ' }, { position: false }, { notes: 'x'.repeat(10001) },
    { jobUrl: 'javascript:alert(1)' }, { jobUrl: '//acme.test/jobs' }, { jobUrl: 'https://user:pass@acme.test' },
    { status: 'accepted' }, { dateApplied: '2026-02-30' }, { dateApplied: 'tomorrow' },
  ]) await assert.rejects(updateJob(user._id, job._id, fields), hasStatus(400));
  assert.equal((await fresh(job)).company, 'Acme');
  assert.equal((await histories(job)).length, 1);
});
test('only the owner can read, edit, delete or add history to an application', async () => {
  const job = await makeJob(other);
  for (const operation of [
    () => getJob(user._id, job._id), () => listHistory(user._id, job._id),
    () => updateJob(user._id, job._id, { company: 'Stolen' }), () => deleteJob(user._id, job._id),
    () => addHistory(user._id, job._id, { status: 'offer' }),
  ]) await assert.rejects(operation(), hasStatus(404));
  assert.equal((await fresh(job)).company, 'Acme');
});
test('history mutations bind both the owner and the exact parent application', async () => {
  const first = await makeJob(), second = await makeJob(), foreign = await makeJob(other);
  const firstEntry = (await histories(first))[0];
  const foreignEntry = await StatusHistory.findOne({ jobId: foreign._id });
  for (const remove of [false, true]) {
    await assert.rejects(changeHistory(user._id, second._id, firstEntry._id, { status: 'offer' }, remove), hasStatus(404));
    await assert.rejects(changeHistory(user._id, first._id, foreignEntry._id, { status: 'offer' }, remove), hasStatus(404));
    await assert.rejects(changeHistory(other._id, first._id, firstEntry._id, { status: 'offer' }, remove), hasStatus(404));
  }
  assert.equal((await histories(first))[0].status, 'applied');
});
test('updating the current status through job editing records the same status on the timeline', async () => {
  const job = await makeJob();
  await updateJob(user._id, job._id, { status: 'offer' });
  assert.equal((await fresh(job)).status, 'offer');
  assert.equal((await histories(job)).at(-1).status, 'offer');
});
test('a backdated added status never overrides a newer timeline event', async () => {
  const job = await makeJob();
  await addHistory(user._id, job._id, { status: 'offer', date: when(10) });
  await addHistory(user._id, job._id, { status: 'interviewing', date: when(5), interviewStage: 'Phone Screen' });
  assert.equal((await fresh(job)).status, 'offer');
  assert.deepEqual((await histories(job)).map((entry) => entry.status), ['applied', 'interviewing', 'offer']);
});
test('editing the latest history status immediately updates the persisted application', async () => {
  const job = await makeJob();
  const { statusHistory: entry } = await addHistory(user._id, job._id, { status: 'interviewing', date: when(5), interviewStage: 'Phone Screen' });
  const result = await changeHistory(user._id, job._id, entry._id, { status: 'offer', notes: 'Updated result' });
  assert.equal(result.job.status, 'offer');
  assert.equal((await fresh(job)).status, 'offer');
  assert.equal((await histories(job)).at(-1).interviewStage, '');
});
test('moving the newest history earlier selects the previously second-newest entry', async () => {
  const job = await makeJob();
  await addHistory(user._id, job._id, { status: 'interviewing', date: when(5) });
  const { statusHistory: offer } = await addHistory(user._id, job._id, { status: 'offer', date: when(10) });
  await changeHistory(user._id, job._id, offer._id, { date: when(3) });
  assert.equal((await fresh(job)).status, 'interviewing');
  assert.equal((await histories(job)).at(-1).status, 'interviewing');
});
test('moving an earlier entry to the newest date changes current state', async () => {
  const job = await makeJob();
  const initial = (await histories(job))[0];
  await addHistory(user._id, job._id, { status: 'offer', date: when(10) });
  await changeHistory(user._id, job._id, initial._id, { status: 'rejected', date: when(11) });
  assert.equal((await fresh(job)).status, 'rejected');
});
test('equal history dates have deterministic creation and ID tie breakers', async () => {
  const job = await makeJob();
  await addHistory(user._id, job._id, { status: 'interviewing', date: when(5) });
  const { statusHistory: offer } = await addHistory(user._id, job._id, { status: 'offer', date: when(5) });
  assert.equal((await fresh(job)).status, 'offer');
  await changeHistory(user._id, job._id, offer._id, null, true);
  assert.equal((await fresh(job)).status, 'interviewing');
});
test('deleting newest, oldest and final history keeps the board consistent', async () => {
  const job = await makeJob();
  const initial = (await histories(job))[0];
  const { statusHistory: interview } = await addHistory(user._id, job._id, { status: 'interviewing', date: when(5) });
  const { statusHistory: offer } = await addHistory(user._id, job._id, { status: 'offer', date: when(10) });
  await changeHistory(user._id, job._id, initial._id, null, true);
  assert.equal((await fresh(job)).status, 'offer');
  await changeHistory(user._id, job._id, offer._id, null, true);
  assert.equal((await fresh(job)).status, 'interviewing');
  await changeHistory(user._id, job._id, interview._id, null, true);
  assert.equal((await histories(job)).length, 0);
  assert.equal((await fresh(job)).status, 'applied');
  assert.equal(await StatusHistory.countDocuments({ deletedAt: { $type: 'date' } }), 3);
});
test('notes-only history edits do not move timestamps or the current-state watermark', async () => {
  const job = await makeJob();
  const entry = (await histories(job))[0];
  await changeHistory(user._id, job._id, entry._id, { notes: 'Corrected note' });
  assert.equal((await histories(job))[0].date.getTime(), entry.date.getTime());
  assert.equal((await fresh(job)).lastStatusEventAt.getTime(), job.lastStatusEventAt.getTime());
});
test('email provenance, identity and eligibility cannot be edited by a client', async () => {
  const job = await makeJob();
  const entry = (await histories(job))[0];
  for (const fields of [
    { userId: other._id }, { jobId: other._id }, { source: { receivedAt: when(20) } },
    { sourceEmailKey: 'forged' }, { statusApplied: true }, { deletedAt: null }, { createdAt: when(1) },
  ]) await assert.rejects(changeHistory(user._id, job._id, entry._id, fields), hasStatus(400));
});
test('editing/deleting a history-only email cannot promote it or destroy its source evidence', async () => {
  const job = await makeJob();
  const event = mailEvent(job);
  await applyEventToJob(event); // The manually created job has a newer watermark.
  const entry = await StatusHistory.findOne({ sourceEmailKey: event.sourceEmailKey });
  assert.equal(entry.statusApplied, false);
  const result = await changeHistory(user._id, job._id, entry._id, { status: 'rejected', date: when(30), scheduledTime: when(29) });
  assert.equal(result.job.status, 'applied');
  assert.equal(result.statusHistory.source.receivedAt.toISOString(), new Date(when(5)).toISOString());
  await changeHistory(user._id, job._id, entry._id, null, true);
  const replay = await applyEventToJob(event);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.statusApplied, false);
  assert.equal(await StatusHistory.countDocuments({ sourceEmailKey: event.sourceEmailKey }), 1);
  assert.equal((await histories(job)).length, 1);
});
test('deleting an applied email leaves a tombstone and replay cannot resurrect it', async () => {
  const job = await Job.create({ company: 'Acme', position: 'Engineer', userId: user._id, dateApplied: when(1) });
  const event = mailEvent(job);
  await applyEventToJob(event);
  const entry = await StatusHistory.findOne({ sourceEmailKey: event.sourceEmailKey });
  assert.equal(entry.statusApplied, true);
  await changeHistory(user._id, job._id, entry._id, null, true);
  assert.equal((await fresh(job)).status, 'applied');
  await applyEventToJob(event);
  assert.equal((await histories(job)).length, 0);
  assert.equal((await fresh(job)).status, 'applied');
});
test('manual history changes establish a watermark that blocks older incoming email', async () => {
  const job = await makeJob();
  const entry = (await histories(job))[0];
  await changeHistory(user._id, job._id, entry._id, { status: 'offer' });
  await applyEventToJob(mailEvent(job));
  assert.equal((await fresh(job)).status, 'offer');
});
test('invalid dates, status and IDs return validation errors without partial writes', async () => {
  const job = await makeJob();
  const entry = (await histories(job))[0];
  for (const fields of [
    { date: '2026-02-30' }, { date: '2026-10-01T12:00:00' }, { status: 'other' },
    { scheduledTime: 'next week' }, { deadline: 1234 }, { notes: false },
  ]) await assert.rejects(changeHistory(user._id, job._id, entry._id, fields), hasStatus(400));
  await assert.rejects(changeHistory(user._id, job._id, 'bad-id', {}), hasStatus(400));
  await assert.rejects(updateJob(user._id, 'bad-id', {}), hasStatus(400));
  assert.equal((await histories(job))[0].status, 'applied');
});
test('a newly received email cannot contradict an active future-dated manual history', async () => {
  const job = await makeJob();
  const future = new Date(Date.now() + 86400000).toISOString();
  await addHistory(user._id, job._id, { status: 'offer', date: future });
  // Simulate a mail arriving just after the manual watermark.
  const result = await applyEventToJob(mailEvent(job, new Date(Date.now() + 1000).toISOString()));
  assert.equal(result.statusApplied, false);
  assert.equal((await fresh(job)).status, 'offer');
});
test('history schedules normalize to UTC and stay separate from event ordering', async () => {
  const job = await makeJob();
  const entry = (await histories(job))[0];
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: '2026-11-01T09:00:00+08:00', deadline: null });
  const result = (await histories(job))[0];
  assert.equal(result.scheduledTime.toISOString(), '2026-11-01T01:00:00.000Z');
  assert.equal(result.date.toISOString(), new Date(when(1)).toISOString());
});
test('failure writing the recomputed job rolls back a history edit and deletion', async (t) => {
  const job = await makeJob();
  const entry = (await histories(job))[0];
  const patch = t.mock.method(Job.prototype, 'save', async () => { throw new Error('save unavailable'); });
  await assert.rejects(changeHistory(user._id, job._id, entry._id, { status: 'offer' }), /save unavailable/);
  await assert.rejects(changeHistory(user._id, job._id, entry._id, null, true), /save unavailable/);
  patch.mock.restore();
  assert.equal((await histories(job)).length, 1);
  assert.equal((await histories(job))[0].status, 'applied');
});
test('history write failure rolls back application creation and a status-changing edit', async (t) => {
  const job = await makeJob();
  const patch = t.mock.method(StatusHistory, 'create', async () => { throw new Error('history unavailable'); });
  await assert.rejects(createJob(user._id, { company: 'New', position: 'Role' }), /history unavailable/);
  await assert.rejects(updateJob(user._id, job._id, { company: 'Changed', status: 'offer' }), /history unavailable/);
  patch.mock.restore();
  assert.equal(await Job.countDocuments(), 1);
  assert.equal((await fresh(job)).company, 'Acme');
  assert.equal((await fresh(job)).status, 'applied');
});
test('concurrent manual history and email processing preserve the intentional current status', async () => {
  const job = await makeJob();
  const initial = (await histories(job))[0];
  await Promise.all([
    changeHistory(user._id, job._id, initial._id, { status: 'offer' }),
    applyEventToJob(mailEvent(job)),
  ]);
  assert.equal((await fresh(job)).status, 'offer');
  assert.equal((await histories(job)).length, 2);
});
test('job API adapter enforces authentication before DB access and resolves async route params', async () => {
  let connects = 0;
  const request = new Request('https://example.test/api/jobs');
  const unauthenticated = createJobRoute(() => { throw new Error('must not run'); }, {
    authenticate: async () => null, connect: async () => { connects++; },
  });
  assert.equal((await unauthenticated(request)).status, 401);
  assert.equal(connects, 0);
  const job = await makeJob();
  const handler = createJobRoute(async ({ userId, params }) => ({ job: await getJob(userId, params.id) }), {
    authenticate: async () => user._id, connect: async () => { connects++; },
  });
  const response = await handler(request, { params: Promise.resolve({ id: String(job._id) }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.company, 'Acme');
  assert.equal((await handler(request, { params: { id: String(other._id) } })).status, 404);
});
test('job API reports invalid bodies and validation failures as 400', async () => {
  const job = await makeJob();
  const handler = createJobRoute(async ({ request, userId, params }) => updateJob(userId, params.id, await readJobBody(request)), {
    authenticate: async () => user._id, connect: async () => {},
  });
  for (const body of ['{broken', '[]', '{"jobUrl":"javascript:alert(1)"}', '{"userId":"forged"}']) {
    const response = await handler(new Request('https://example.test/api/jobs', { method: 'PATCH', body }), { params: { id: String(job._id) } });
    assert.equal(response.status, 400);
  }
});
