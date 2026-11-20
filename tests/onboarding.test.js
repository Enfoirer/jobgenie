import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import { createOnboardingHandler } from '../lib/onboarding/routeHandler.js';

let replica, owner, other;
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User.init(), Job.init()]);
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Job.deleteMany({})]);
  owner = await User.create({ email: 'guide@example.test', password: 'private-test-password' });
  other = await User.create({ email: 'other@example.test', password: 'private-test-password' });
});
const handler = (id, options = {}) => createOnboardingHandler({ authenticate: async () => id, connect: async () => {}, limit: async () => true, ...options });
const request = (action, headers = {}) => new Request('https://example.test/api/onboarding', action === undefined ? {} : {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.test', ...headers }, body: JSON.stringify(action),
});

test('new and legacy users without jobs are eligible; another account does not affect eligibility', async () => {
  await Job.create({ userId: other._id, company: 'Private company', position: 'Engineer' });
  const response = await handler(owner._id)(request());
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { eligible: true, outcome: null });
  assert.equal((await User.findById(owner._id)).webOnboarding, undefined);
});
test('existing applications including archived ones suppress automatic onboarding', async () => {
  await Job.create({ userId: owner._id, company: 'Existing', position: 'Engineer', archivedAt: new Date() });
  assert.deepEqual(await (await handler(owner._id)(request())).json(), { eligible: false, outcome: null });
});
test('completion and skip persist across fresh authenticated handlers without exposing private fields', async () => {
  for (const [id, action] of [[owner._id, 'completed'], [other._id, 'skipped']]) {
    const result = await handler(id)(request({ action }));
    assert.deepEqual(await result.json(), { eligible: false, outcome: action });
    const user = await User.findById(id);
    assert.equal(user.webOnboarding.outcome, action); assert(user.webOnboarding.finishedAt instanceof Date);
    assert.deepEqual(await (await handler(id)(request())).json(), { eligible: false, outcome: action });
  }
});
test('concurrent retries preserve the first outcome and its original timestamp', async () => {
  const route = handler(owner._id);
  await route(request({ action: 'completed' }));
  const first = (await User.findById(owner._id)).webOnboarding.finishedAt;
  const responses = await Promise.all(Array.from({ length: 8 }, () => route(request({ action: 'skipped' }))));
  for (const response of responses) assert.equal((await response.json()).outcome, 'completed');
  assert.equal((await User.findById(owner._id)).webOnboarding.finishedAt.getTime(), first.getTime());
  assert.equal((await User.findById(other._id)).webOnboarding, undefined);
});
test('anonymous/deleted sessions, cross-origin mutations and supplied account IDs cannot change preferences', async () => {
  assert.equal((await handler(null)(request())).status, 401);
  assert.equal((await handler(owner._id)(request({ action: 'skipped' }, { origin: 'https://attacker.test' }))).status, 403);
  assert.equal((await handler(owner._id)(request({ action: 'skipped', userId: String(other._id) }))).status, 400);
  await User.deleteOne({ _id: owner._id });
  assert.equal((await handler(owner._id)(request({ action: 'skipped' }))).status, 401);
  assert.equal((await User.findById(other._id)).webOnboarding, undefined);
});
test('invalid choices, oversized packets, malformed JSON and unsupported methods are rejected', async () => {
  const route = handler(owner._id);
  for (const body of [null, [], {}, { action: 'later' }, { action: { $ne: null } }, { action: 'skipped', padding: 'x'.repeat(600) }]) {
    const response = await route(request(body)); assert([400, 413].includes(response.status));
  }
  assert.equal((await route(new Request('https://example.test/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal((await route(request({ action: 'skipped' }, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await route(new Request('https://example.test/api/onboarding', { method: 'DELETE' }))).status, 405);
  assert.equal((await User.findById(owner._id)).webOnboarding, undefined);
});
test('rate limits and database failures return bounded safe errors', async () => {
  const limited = await handler(owner._id, { limit: async () => false })(request({ action: 'skipped' }));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  const failed = await handler(owner._id, { connect: async () => { throw new Error('private-token-body'); } })(request());
  assert.equal(failed.status, 503); assert.equal((await failed.text()).includes('private-token-body'), false);
});
