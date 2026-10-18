import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import { createJob, addHistory, changeHistory, updateJob, deleteJob } from '../lib/jobs/jobMutations.js';
import { parseStatsRange, dateInZone } from '../lib/analytics/range.js';
import { computeStats, loadStats } from '../lib/analytics/stats.js';
import { createStatsRoute } from '../lib/analytics/routeHandler.js';

const now = Date.parse('2026-11-12T12:00:00Z');
const range = (query = 'start=2026-03-01&end=2026-03-31&timeZone=Asia/Shanghai', clock = now) => parseStatsRange(new URLSearchParams(query), clock);
const stamp = (day, month = '03') => `2026-${month}-${String(day).padStart(2, '0')}T10:00:00Z`;
let replica, user, other;
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User.init(), Job.init(), StatusHistory.init()]);
});
after(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Job.deleteMany({}), StatusHistory.deleteMany({})]);
  user = await User.create({ email: 'analytics@example.test', password: 'test-only' });
  other = await User.create({ email: 'other@example.test', password: 'test-only' });
});
const job = async (company = 'Acme', dateApplied = stamp(1), owner = user) => (await createJob(owner._id, { company, position: 'Engineer', dateApplied })).job;
const history = async (application, status, date, more = {}) => (await addHistory(application.userId, application._id, { status, date, ...more })).statusHistory;
const read = (period = range()) => loadStats(user._id, period);

test('defaults and presets use full local dates, not a rolling 24-hour window', () => {
  const result = range('');
  assert.equal(result.days, 30); assert.equal(result.start, '2026-10-14'); assert.equal(result.end, '2026-11-12');
  const shanghai = range('days=1&timeZone=Asia/Shanghai', Date.parse('2026-03-01T20:00:00Z'));
  assert.equal(shanghai.start, '2026-03-02');
  assert.equal(new Date(shanghai.startMs).toISOString(), '2026-03-01T16:00:00.000Z');
  assert.equal(new Date(shanghai.endMs).toISOString(), '2026-03-02T16:00:00.000Z');
});
test('invalid days, dates, zones, duplicates and mixed ranges fail validation', () => {
  for (const query of ['days=0', 'days=367', 'days=1.5', 'days=1e2', 'days=-1', 'days=', 'days=Infinity',
    'start=2026-02-30&end=2026-03-01', 'start=2026-03-02&end=2026-03-01', 'start=2026-03-01',
    'start=2026-03-01&end=2026-03-02&days=1', 'start=2025-01-01&end=2026-11-01',
    'end=2026-11-13&start=2026-11-12', 'timeZone=Invalid/Zone', 'timeZone=', 'days=1&days=2', 'unknown=1']) {
    assert.throws(() => range(query), (error) => error.status === 400, query);
  }
});
test('DST spring and fall ranges cover exactly 23 and 25 hours', () => {
  const spring = range('start=2026-03-08&end=2026-03-08&timeZone=America/Los_Angeles');
  const fall = range('start=2026-11-01&end=2026-11-01&timeZone=America/Los_Angeles');
  assert.equal(spring.endMs - spring.startMs, 23 * 3600000);
  assert.equal(fall.endMs - fall.startMs, 25 * 3600000);
  assert.equal(new Date(spring.startMs).toISOString(), '2026-03-08T08:00:00.000Z');
  assert.equal(new Date(fall.endMs).toISOString(), '2026-11-02T08:00:00.000Z');
});
test('half-hour zones, midnight DST gaps and leap days use calendar boundaries', () => {
  const india = range('start=2026-03-01&end=2026-03-01&timeZone=Asia/Kolkata');
  assert.equal(new Date(india.startMs).toISOString(), '2026-02-28T18:30:00.000Z');
  const brazil = range('start=2018-11-04&end=2018-11-04&timeZone=America/Sao_Paulo');
  assert.equal(new Date(brazil.startMs).toISOString(), '2018-11-04T03:00:00.000Z');
  assert.equal(brazil.endMs - brazil.startMs, 23 * 3600000);
  assert.equal(range('start=2024-02-28&end=2024-03-01').days, 3);
  const skipped = range('start=2011-12-30&end=2011-12-30&timeZone=Pacific/Apia');
  assert.equal(skipped.startMs, skipped.endMs);
});
test('start is inclusive, next midnight exclusive, and UTC/Shanghai classify differently', async () => {
  const atStart = await job('Boundary', '2026-02-28T16:00:00Z');
  await history(atStart, 'interviewing', '2026-03-01T15:59:59.999Z');
  await history(atStart, 'offer', '2026-03-01T16:00:00Z');
  const shanghai = await read(range('start=2026-03-01&end=2026-03-01&timeZone=Asia/Shanghai'));
  assert.equal(shanghai.cohort.total, 1); assert.equal(shanghai.cohort.reached.interviewing, 1); assert.equal(shanghai.cohort.reached.offer, 0);
  assert.deepEqual(Object.keys(shanghai.timeline), ['2026-03-01']);
  assert.equal(shanghai.timeline['2026-03-01'].applied, 1);
  const utc = await read(range('start=2026-03-01&end=2026-03-01&timeZone=UTC'));
  assert.equal(utc.cohort.total, 0); assert.equal(utc.timeline['2026-03-01'].offer, 1);
});
test('future events today and future applications cannot leak beyond the server cutoff', async () => {
  const clock = Date.parse('2026-03-01T12:00:00Z');
  const application = await job('Now', '2026-03-01T11:00:00Z');
  await history(application, 'interviewing', new Date(clock).toISOString());
  await history(application, 'offer', new Date(clock + 1).toISOString());
  await job('Future', '2026-03-01T13:00:00Z');
  const result = await read(range('days=1&timeZone=UTC', clock));
  assert.equal(result.cohort.total, 1); assert.equal(result.cohort.reached.interviewing, 1); assert.equal(result.cohort.reached.offer, 0);
  assert.equal(result.timeline['2026-03-01'].applications, 1);
  assert.equal(result.currentStatus.total, 2);
});
test('current distribution and recorded cohort conversion have independent meanings', async () => {
  const a = await job('A');
  await history(a, 'interviewing', stamp(2)); await history(a, 'interviewing', stamp(3));
  await history(a, 'offer', stamp(4)); await history(a, 'rejected', stamp(5));
  const b = await job('B', stamp(2)); await history(b, 'rejected', stamp(3));
  const c = await job('C', stamp(3)); await history(c, 'offer', stamp(4));
  const d = await job('D', stamp(4)); await history(d, 'interviewing', stamp(5), { interviewStage: 'Online Assessment' }); await history(d, 'offer', stamp(1, '04'));
  const old = await job('Old', stamp(1, '02')); await history(old, 'interviewing', stamp(5));
  const result = await read();
  assert.deepEqual(result.currentStatus.counts, { applied: 0, interviewing: 1, offer: 2, rejected: 2 });
  assert.deepEqual(result.cohort.reached, { applied: 4, interviewing: 2, offer: 2, rejected: 2 });
  assert.deepEqual(result.cohort.conversion.appliedToInterview, { numerator: 2, denominator: 4, percent: 50 });
  assert.deepEqual(result.cohort.conversion.interviewToOffer, { numerator: 1, denominator: 2, percent: 50 });
  assert.equal(result.cohort.conversion.appliedToOffer.percent, 50);
  assert.equal(result.cohort.offersWithoutPriorInterview, 1);
  assert.equal(Object.values(result.timeline).reduce((sum, day) => sum + day.interviewing, 0), 4);
});
test('a rejection does not imply interview, and direct offers do not invent a prior stage', async () => {
  const rejected = await job(); await history(rejected, 'rejected', stamp(2));
  const direct = await job('Direct'); await history(direct, 'offer', stamp(3));
  const result = await read();
  assert.equal(result.cohort.reached.interviewing, 0);
  assert.deepEqual(result.cohort.conversion.interviewToOffer, { numerator: 0, denominator: 0, percent: null });
  assert.equal(result.cohort.conversion.appliedToOffer.percent, 50);
});
test('offers before the first interview do not count as interview-to-offer conversion', async () => {
  const application = await job(); await history(application, 'offer', stamp(2)); await history(application, 'interviewing', stamp(3));
  assert.equal((await read()).cohort.conversion.interviewToOffer.numerator, 0);
  await history(application, 'offer', stamp(4));
  assert.equal((await read()).cohort.conversion.interviewToOffer.numerator, 1);
});
test('equal timestamps count a documented transition once, regardless of repeated rounds', async () => {
  const application = await job();
  await history(application, 'interviewing', stamp(2)); await history(application, 'interviewing', stamp(2)); await history(application, 'offer', stamp(2));
  const result = await read();
  assert.equal(result.cohort.conversion.interviewToOffer.percent, 100);
  assert.equal(result.timeline['2026-03-02'].interviewing, 2);
});
test('history-only emails establish historical reach without being used as current status', async () => {
  const application = await job();
  const entry = await history(application, 'interviewing', stamp(2));
  await StatusHistory.updateOne({ _id: entry._id }, { $set: { statusApplied: false } });
  await history(application, 'offer', stamp(3));
  const result = await read();
  assert.equal(result.currentStatus.counts.offer, 1); assert.equal(result.currentStatus.counts.interviewing, 0);
  assert.equal(result.cohort.reached.interviewing, 1); assert.equal(result.cohort.conversion.interviewToOffer.percent, 100);
});
test('changing the end date changes observation, while the current distribution stays current', async () => {
  const application = await job(); await history(application, 'interviewing', stamp(2)); await history(application, 'offer', stamp(10));
  const early = await read(range('start=2026-03-01&end=2026-03-05'));
  const later = await read();
  assert.deepEqual(early.currentStatus, later.currentStatus);
  assert.equal(early.cohort.reached.offer, 0); assert.equal(later.cohort.reached.offer, 1);
});
test('empty cohorts return null rates and complete zero-filled ordered date buckets', async () => {
  const result = await read(range('start=2026-03-01&end=2026-03-03'));
  assert.equal(result.currentStatus.total, 0); assert.equal(result.cohort.total, 0);
  assert.equal(result.cohort.conversion.appliedToInterview.percent, null);
  assert.deepEqual(Object.keys(result.timeline), ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.ok(Object.values(result.timeline).every((row) => Object.values(row).every((count) => count === 0)));
});
test('missing histories are reported and current status is never fabricated into stage history', async () => {
  await Job.create({ userId: user._id, company: 'Legacy', position: 'Role', status: 'offer', dateApplied: stamp(1) });
  const result = await read();
  assert.equal(result.currentStatus.counts.offer, 1); assert.equal(result.cohort.reached.offer, 0); assert.equal(result.cohort.withoutHistory, 1);
});
test('timestamps before application date do not establish a cohort stage', async () => {
  const application = await job('Corrected date', stamp(5)); await history(application, 'offer', stamp(2));
  const result = await read();
  assert.equal(result.cohort.reached.offer, 0); assert.equal(result.timeline['2026-03-02'].offer, 1);
});
test('schedule times never determine statistical event dates', async () => {
  const application = await job(); await history(application, 'interviewing', stamp(2), { scheduledTime: stamp(15), deadline: stamp(20) });
  const result = await read();
  assert.equal(result.timeline['2026-03-02'].interviewing, 1); assert.equal(result.timeline['2026-03-15'].interviewing, 0);
  assert.equal(result.cohort.applications[0].interviewAt, new Date(stamp(2)).toISOString());
});
test('editing and deleting history updates trend and conversion without stale counts', async () => {
  const application = await job(); const entry = await history(application, 'interviewing', stamp(2)); await history(application, 'offer', stamp(3));
  await changeHistory(user._id, application._id, entry._id, { date: stamp(4) });
  let result = await read();
  assert.equal(result.timeline['2026-03-02'].interviewing, 0); assert.equal(result.timeline['2026-03-04'].interviewing, 1);
  assert.equal(result.cohort.conversion.interviewToOffer.numerator, 0);
  await changeHistory(user._id, application._id, entry._id, null, true);
  result = await read(); assert.equal(result.cohort.reached.interviewing, 0); assert.equal(result.timeline['2026-03-04'].interviewing, 0);
});
test('application edits change cohort membership and deletion removes all associated metrics', async () => {
  const application = await job(); await history(application, 'interviewing', stamp(2));
  await updateJob(user._id, application._id, { dateApplied: stamp(1, '02'), company: 'Renamed' });
  assert.equal((await read()).cohort.total, 0); assert.equal((await read()).currentStatus.total, 1);
  await deleteJob(user._id, application._id);
  assert.equal((await read()).currentStatus.total, 0); assert.equal((await read()).timeline['2026-03-02'].interviewing, 0);
});
test('owner, exact parent and orphan filtering protect every metric and detail row', async () => {
  const owned = await job(); const foreign = await job('Secret', stamp(1), other);
  await history(foreign, 'offer', stamp(2));
  await StatusHistory.create([
    { userId: user._id, jobId: foreign._id, status: 'offer', date: stamp(2) },
    { userId: other._id, jobId: owned._id, status: 'offer', date: stamp(2) },
    { userId: user._id, jobId: new mongoose.Types.ObjectId(), status: 'offer', date: stamp(2) },
  ]);
  const result = await read(); assert.equal(result.currentStatus.total, 1); assert.equal(result.cohort.reached.offer, 0);
  assert.equal(result.timeline['2026-03-02'].offer, 0); assert.ok(!JSON.stringify(result).includes('Secret'));
});
test('invalid legacy dates do not create epoch buckets or corrupt counts', () => {
  const result = computeStats([{ _id: '1', status: 'offer', dateApplied: null }], [{ jobId: '1', status: 'offer', date: null }], range());
  assert.equal(result.currentStatus.counts.offer, 1); assert.equal(result.cohort.total, 0);
  assert.equal(Object.values(result.timeline).reduce((sum, row) => sum + row.offer, 0), 0);
});
test('range and bucket results do not depend on the process time zone', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu'; const one = range('days=7&timeZone=Asia/Shanghai');
    process.env.TZ = 'Europe/London'; const two = range('days=7&timeZone=Asia/Shanghai');
    assert.deepEqual(one, two); assert.equal(dateInZone(one.startMs, 'Asia/Shanghai'), one.start);
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
test('API authenticates and validates before database work, and disables response caching', async () => {
  let connections = 0;
  const connect = async () => { connections++; };
  const anonymous = createStatsRoute({ authenticate: async () => null, connect });
  assert.equal((await anonymous(new Request('https://example.test/api/stats'))).status, 401);
  const handler = createStatsRoute({ authenticate: async () => user._id, connect, clock: () => now });
  assert.equal((await handler(new Request('https://example.test/api/stats?days=1.2'))).status, 400);
  assert.equal(connections, 0);
  const response = await handler(new Request('https://example.test/api/stats?days=7'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await response.json()).range.days, 7); assert.equal(connections, 1);
});
