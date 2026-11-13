import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import ProductFeedback from '../lib/models/ProductFeedback.js';
import { createAdminFeedbackHandler, feedbackQuery } from '../lib/admin/feedback.js';
import { createRegisterHandler } from '../lib/auth/registerHandler.js';
let replica, admin, member;
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri()); await Promise.all([User.init(), ProductFeedback.init()]);
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), ProductFeedback.deleteMany({})]);
  admin = await User.create({ email: 'admin@example.test', password: 'private-test-password', role: 'admin' });
  member = await User.create({ email: 'member@example.test', password: 'private-test-password' });
  await ProductFeedback.create({ _id: 'test:campaign', userId: member._id, campaign: 'test', overall: 1, recommendation: 2,
    comment: '<img src=x onerror=alert(1)>', source: 'manual', platform: 'web', appVersion: '1.0', createdAt: new Date('2026-11-13T23:59:59.999Z') });
});
const handler = userId => createAdminFeedbackHandler({ authenticate: async () => userId, connect: async () => {} });
const request = query => new Request(`https://example.test/api/admin/feedback${query ? '?' + query : ''}`);
test('anonymous and ordinary/legacy users cannot read feedback; revoked administrators lose access immediately', async () => {
  assert.equal((await handler(null)(request())).status, 401);
  assert.equal((await handler(member._id)(request())).status, 403);
  await User.collection.updateOne({ _id: member._id }, { $unset: { role: '' } });
  assert.equal((await handler(member._id)(request())).status, 403);
  const review = handler(admin._id); assert.equal((await review(request())).status, 200);
  await User.updateOne({ _id: admin._id }, { $set: { role: 'user' } });
  assert.equal((await review(request())).status, 403);
  await User.deleteOne({ _id: admin._id }); assert.equal((await review(request())).status, 403);
});
test('registration cannot grant an administrator role', async () => {
  const register = createRegisterHandler({ connect: async () => {}, checkIp: async () => {}, checkEmail: async () => {} });
  const response = await register(new Request('https://example.test/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'attacker@example.test', password: 'example-password', role: 'admin' }) }));
  assert.equal(response.status, 400); assert.equal(await User.countDocuments({ role: 'admin' }), 1);
});
test('responses use explicit fields and private no-store caching', async () => {
  const response = await handler(admin._id)(request()); const text = await response.text(); const result = JSON.parse(text);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.total, 1); assert.equal(result.items[0].overall, 1);
  for (const field of ['userId', 'password', 'invitationId', 'email', 'sessionId', 'activeDayCount']) assert.equal(Object.hasOwn(result.items[0], field), false);
  assert.equal(text.includes('private-test-password'), false);
  assert.equal(result.items[0].comment, '<img src=x onerror=alert(1)>');
});
test('platform, exact version, source and inclusive UTC dates combine correctly', async () => {
  const review = handler(admin._id);
  assert.equal((await (await review(request('platform=web&version=1.0&source=manual&start=2026-11-13&end=2026-11-13'))).json()).total, 1);
  for (const query of ['platform=ios', 'version=1', 'source=prompt', 'start=2026-11-14', 'end=2026-11-12']) assert.equal((await (await review(request(query))).json()).total, 0);
});
test('missing legacy fields are Unknown and can be filtered separately from a literal version', async () => {
  await ProductFeedback.collection.insertOne({ _id: 'legacy', userId: member._id, campaign: 'old', overall: 5, recommendation: 4, createdAt: new Date('2020-01-01') });
  const result = await (await handler(admin._id)(request('platform=unknown&missingVersion=1'))).json();
  assert.equal(result.total, 1); assert.equal(result.items[0].platform, 'unknown'); assert.equal(result.items[0].appVersion, 'Unknown');
  assert.equal(result.items[0].source, 'unknown');
});
test('duplicate/invalid filters, dates, cursors and injection strings are rejected', () => {
  for (const query of ['platform=web&platform=ios', 'platform=admin', 'start=2026-02-30', 'start=2026-11-14&end=2026-11-13', 'version[$ne]=x', 'version=%7B%22%24ne%22:null%7D', 'version=1&missingVersion=1', 'missingVersion=0', 'cursor=invalid', 'cursor=']) {
    assert.throws(() => feedbackQuery(new URLSearchParams(query)), error => error.status === 400, query);
  }
});
test('stable pagination retains identical timestamps without duplicates and preserves filters', async () => {
  const rows = Array.from({ length: 54 }, (_, index) => ({ _id: `row-${String(index).padStart(3, '0')}`, userId: member._id, campaign: 'test', overall: 3, recommendation: 4, source: 'prompt', platform: 'ios', createdAt: new Date('2026-11-12') }));
  await ProductFeedback.insertMany(rows);
  const review = handler(admin._id); let cursor = '', count = 0; const comments = [];
  // Unique comments identify each fixture without exposing user IDs in responses.
  await Promise.all(rows.map(row => ProductFeedback.updateOne({ _id: row._id }, { $set: { comment: row._id } })));
  do {
    const result = await (await review(request('platform=ios' + (cursor ? '&cursor=' + cursor : '')))).json();
    assert.equal(result.total, 54); assert.ok(result.items.length <= 25);
    count += result.items.length; comments.push(...result.items.map(item => item.comment)); cursor = result.nextCursor;
  } while (cursor);
  assert.equal(count, 54); assert.equal(new Set(comments).size, 54);
});
test('unexpected server failures disclose no exception or feedback data', async () => {
  const route = createAdminFeedbackHandler({ authenticate: async () => admin._id, connect: async () => { throw new Error('secret token and mail body'); } });
  const response = await route(request()); assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('secret token'), false);
});
