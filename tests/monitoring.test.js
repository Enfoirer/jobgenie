import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import ErrorIncident from '../lib/models/ErrorIncident.js';
import User from '../lib/models/User.js';
import { safeIncident, safeRoute, referencePattern } from '../lib/monitoring/policy.js';
import { recordIncident, observeRoute, noteFailure } from '../lib/monitoring/server.js';
import { createReportHandler } from '../lib/monitoring/report.js';
import { createErrorReviewHandler } from '../lib/admin/errors.js';
let replica, admin, member;
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri()); await Promise.all([ErrorIncident.init(), User.init()]);
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all([ErrorIncident.deleteMany({}), User.deleteMany({})]);
  admin = await User.create({ email: 'monitor-admin@example.test', password: 'test-only', role: 'admin' });
  member = await User.create({ email: 'monitor-member@example.test', password: 'test-only' });
});
const input = { platform: 'server', kind: 'type_error', route: '/api/jobs', method: 'POST', version: '0.1.0', status: 500 };
const connect = async () => {};
const save = (data = input, options = {}) => recordIncident(data, { connect, ...options });
test('allowlist drops credentials, mail bodies, errors, URLs and identifiers', () => {
  const result = safeIncident({ ...input, route: '/api/jobs/private@example.com?token=secret', version: 'API_SECRET', message: 'mail body', stack: 'password', body: { token: 'secret' }, digest: 'secret' });
  assert.equal(result.route, 'unknown'); assert.equal(result.version, 'unknown');
  assert.equal(JSON.stringify(result).includes('secret'), false); assert.equal(JSON.stringify(result).includes('password'), false);
  assert.equal(safeRoute('/api/jobs/0123456789abcdef01234567?token=secret'), '/api/jobs/[id]');
  assert.equal(safeIncident({ ...input, location: 'lib/fixture-token.js:1:1' }).location, null);
  assert.equal(safeIncident({ ...input, location: 'lib/jobs/jobMutations.js:42:7' }).location, 'lib/jobs/jobMutations.js:42:7');
});
test('matching concurrent reports share a durable reference/count and expire after 30 days', async () => {
  const now = Date.now();
  const results = await Promise.all(Array.from({ length: 10 }, () => save(input, { now })));
  assert.equal(new Set(results.map(row => row.errorId)).size, 1); assert.match(results[0].errorId, referencePattern);
  const row = await ErrorIncident.findById(results[0].errorId).lean();
  assert.equal(row.count, 10); assert.equal(row.expiresAt - row.createdAt, 30 * 86400000);
  assert.equal(row.dedupeKey, undefined);
});
test('different accounts and time windows do not merge client reports', async () => {
  const a = await save({ ...input, platform: 'web' }, { actor: 'a', now: 1800000000000 });
  const b = await save({ ...input, platform: 'web' }, { actor: 'b', now: 1800000000000 });
  const c = await save({ ...input, platform: 'web' }, { actor: 'a', now: 1800000060000 });
  assert.equal(new Set([a.errorId, b.errorId, c.errorId]).size, 3);
});
test('failed diagnostics leave a sanitized fallback log and preserve the original response', async () => {
  const logs = [];
  const reporter = data => save({ ...data, message: 'secret password and email body' }, { write: async () => { throw new Error('credential secret'); }, log: line => logs.push(line) });
  const route = observeRoute(async () => { throw new TypeError('secret password and email body'); }, '/api/jobs/[id]', reporter);
  const response = await route(new Request('https://example.test/api/jobs/private?token=secret', { method: 'POST', body: 'password=secret' }));
  const body = await response.json(); assert.equal(response.status, 500); assert.equal(body.stored, false);
  assert.match(response.headers.get('X-Error-Reference'), referencePattern);
  assert.equal(logs.join('').includes('secret'), false); assert.equal(JSON.stringify(body).includes('email body'), false);
});
test('diagnostic storage cannot block an error response indefinitely', async () => {
  const started = Date.now(), logs = [];
  const result = await save(input, { write: () => new Promise(() => {}), log: value => logs.push(value) });
  assert.equal(result.stored, false); assert.equal(logs.length, 1);
  assert.ok(Date.now() - started < 3000);
});
test('handled API failures retain safe error classification and stable references', async () => {
  const route = observeRoute(async () => { noteFailure(new TypeError('secret')); return Response.json({ error: 'secret' }, { status: 503 }); }, '/api/jobs', data => save(data));
  const response = await route(new Request('https://example.test/api/jobs'));
  const body = await response.json(); assert.equal(response.status, 503); assert.equal(body.error.includes('secret'), false);
  const row = await ErrorIncident.findById(body.errorId); assert.equal(row.kind, 'type_error');
});
test('expected business errors and framework redirects retain their behavior', async () => {
  const response = await observeRoute(async () => Response.json({ error: 'Invalid input' }, { status: 400 }), '/api/jobs', () => { throw new Error('must not report'); })(new Request('https://example.test'));
  assert.equal(response.status, 400);
  await assert.rejects(observeRoute(async () => { throw { digest: 'NEXT_REDIRECT;replace;/login;307;' }; }, '/')({}), error => error.digest.startsWith('NEXT_REDIRECT'));
});
const request = data => new Request('https://example.test/api/monitoring/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const clientInput = { ...input, platform: 'web', kind: 'unhandled_error' };
test('client ingestion authenticates, bounds and validates reports and applies a rate limit', async () => {
  const create = options => createReportHandler({ authenticate: async () => member._id, connect, limit: async () => true, ...options });
  assert.equal((await create({ authenticate: async () => null })(request(clientInput))).status, 401);
  assert.equal((await create() (request({ ...clientInput, message: 'password secret' }))).status, 400);
  assert.equal((await create()(request({ ...clientInput, route: 'x'.repeat(3000) }))).status, 413);
  assert.equal((await create({ limit: async () => false })(request(clientInput))).status, 429);
  const result = await (await create()(request(clientInput))).json(); assert.match(result.errorId, referencePattern);
});
test('administrator lookup finds the user reference and filters version/platform/date; ordinary users and revoked admins cannot read', async () => {
  const result = await save();
  const route = id => createErrorReviewHandler({ authenticate: async () => id, connect });
  const req = query => new Request(`https://example.test/api/admin/errors?${query}`);
  assert.equal((await route(null)(req(''))).status, 401); assert.equal((await route(member._id)(req(''))).status, 403);
  const found = await (await route(admin._id)(req(`reference=${result.errorId}&platform=server&version=0.1.0`))).json();
  assert.equal(found.items[0]._id, result.errorId);
  assert.equal(found.items[0].dedupeKey, undefined); assert.equal(found.items[0].expiresAt, undefined);
  assert.equal((await (await route(admin._id)(req('platform=ios'))).json()).items.length, 0);
  assert.equal((await route(admin._id)(req('start=2026-02-30'))).status, 400);
  await User.updateOne({ _id: admin._id }, { $set: { role: 'user' } });
  assert.equal((await route(admin._id)(req(''))).status, 403);
});
