import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, connect } from 'node:http2';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import PushDevice from '../lib/models/PushDevice.js';
import PushDelivery from '../lib/models/PushDelivery.js';
import PushWorker from '../lib/models/PushWorker.js';
import { createJob, addHistory, changeHistory, deleteJob, archiveJob, updateJob } from '../lib/jobs/jobMutations.js';
import { actOnReminder, saveReminderSettings } from '../lib/reminders/reminders.js';
import { registerDevice, revokeDevice, hash } from '../lib/push/devices.js';
import { runPushWorker, resolveNotification } from '../lib/push/worker.js';
import { apnsConfig, providerToken, notificationPayload, sendAPNs } from '../lib/push/apns.js';
import { createPushHandler } from '../lib/push/routeHandler.js';

const now = Date.parse('2030-11-12T10:00:00Z');
const at = minutes => new Date(now + minutes * 60000).toISOString();
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const env = { PUSH_ENABLED: 'true', APNS_TEAM_ID: 'TESTTEAM01', APNS_KEY_ID: 'TESTKEY001',
  APNS_TOPIC: 'com.example.jobgenie', APNS_PRIVATE_KEY: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  APNS_ALLOW_SANDBOX: 'true', CRON_SECRET: 'test-only-cron-secret-with-at-least-32-characters' };
const config = apnsConfig(env);
const key = 'a'.repeat(64), token = 'b'.repeat(64);
const body = (overrides = {}) => ({ installationKey: key, sequence: 1, token, environment: 'sandbox', locale: 'en', ...overrides });
let replica, user, other, job, entry, identity;
const models = [User, Job, StatusHistory, PushDevice, PushDelivery, PushWorker];
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all(models.map(model => model.init()));
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all(models.map(model => model.deleteMany({})));
  user = await User.create({ email: 'push@example.test', password: 'test-only' });
  other = await User.create({ email: 'other@example.test', password: 'test-only' });
  identity = { userId: String(user._id), sessionId: 'test-session', expires: at(120) };
  ({ job } = await createJob(user._id, { company: 'Private company', position: 'Private role' }));
  ({ statusHistory: entry } = await addHistory(user._id, job._id, { status: 'interviewing', scheduledTime: at(30) }));
});
const register = (overrides = {}, who = identity) => registerDevice(who, body(overrides), config, now);
const run = (options = {}) => runPushWorker({ config, clock: () => now, send: async () => ({ status: 'sent' }), ...options });
const act = action => actOnReminder(user._id, { historyId: String(entry._id), kind: 'appointment', revision: 0, action }, now);
const status = code => error => error.status === code;

test('configuration is opt-in and signing keys must be P-256', () => {
  assert.equal(apnsConfig({ ...env, PUSH_ENABLED: '' }), null);
  assert.equal(apnsConfig({ ...env, APNS_PRIVATE_KEY: 'not a key' }), null);
  assert.deepEqual(apnsConfig({ ...env, APNS_ALLOW_SANDBOX: '' }).environments, ['production']);
  const jwt = providerToken(config, now).split('.');
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).iss, env.APNS_TEAM_ID);
  assert.ok(verify('sha256', Buffer.from(`${jwt[0]}.${jwt[1]}`), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')));
});
test('registration is private, idempotent and bound to a live authenticated session', async () => {
  const first = await register(), second = await register();
  assert.deepEqual(first, second);
  assert.equal(await PushDevice.countDocuments({ active: true }), 1);
  assert.equal((await PushDevice.findOne().lean()).token, undefined);
  assert.equal(JSON.stringify(first).includes(token), false);
  await assert.rejects(register({}, { ...identity, expires: at(-1) }), status(401));
  await assert.rejects(register({ sequence: 0 }), status(400));
  await assert.rejects(register({ token: 'invalid' }), status(400));
  await assert.rejects(registerDevice(identity, body(), null, now), status(503));
});
test('logout tombstone rejects delayed registration; old revokes cannot disable newer bindings', async () => {
  await register();
  await revokeDevice({ installationKey: key, sequence: 2 }, now);
  await assert.rejects(register(), status(409));
  await register({ sequence: 3 });
  await revokeDevice({ installationKey: key, sequence: 2 }, now);
  assert.equal((await PushDevice.findOne()).active, true);
});
test('offline logout before first registration also blocks a late request', async () => {
  await revokeDevice({ installationKey: key, sequence: 4 }, now);
  await assert.rejects(register({ sequence: 3 }), status(409));
  assert.equal(await PushDevice.countDocuments({ active: true }), 0);
});
test('new account on the same installation replaces previous ownership', async () => {
  await register();
  const next = { ...identity, userId: String(other._id), sessionId: 'other-session' };
  await register({ sequence: 2 }, next);
  assert.equal((await run()).attempted, 0);
  assert.equal(String((await PushDevice.findOne()).userId), String(other._id));
  await assert.rejects(register(), status(409));
});
test('the same APNs token cannot stay active under two installations/accounts', async () => {
  await register();
  await register({ installationKey: 'c'.repeat(64) }, { ...identity, userId: String(other._id), sessionId: 'other' });
  assert.equal(await PushDevice.countDocuments({ active: true }), 1);
  assert.equal((await run()).attempted, 0);
});
test('repeated/concurrent workers send a reminder once', async () => {
  await register();
  let sends = 0;
  const options = { send: async () => { sends++; await new Promise(resolve => setTimeout(resolve, 15)); return { status: 'sent' }; } };
  await Promise.all([run(options), run(options), run(options)]);
  await run(options);
  assert.equal(sends, 1); assert.equal(await PushDelivery.countDocuments(), 1);
});
test('token/locale refresh and same-account relogin do not resend an existing occurrence', async () => {
  await register(); await run();
  await register({ sequence: 2, token: 'c'.repeat(64), locale: 'zh-Hans' });
  assert.equal((await run()).attempted, 0);
  await revokeDevice({ installationKey: key, sequence: 3 }, now);
  await register({ sequence: 4 }, { ...identity, sessionId: 'new-session' });
  assert.equal((await run()).attempted, 0);
});
test('reschedule A to B to A creates new versions; cleared/deleted versions cannot resolve', async () => {
  await register(); await run();
  const delivery = await PushDelivery.findOne().lean();
  const resolve = () => resolveNotification(identity, { installationKey: key, sequence: 1, deliveryId: delivery._id }, now);
  assert.equal((await resolve()).jobId, String(job._id));
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(40) });
  await assert.rejects(resolve(), status(409)); assert.equal((await run()).sent, 1);
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(30) });
  assert.equal((await run()).sent, 1);
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: null });
  assert.equal((await run()).sent, 0); await assert.rejects(resolve(), status(409));
});
for (const [name, mutate] of [
  ['history deletion', () => changeHistory(user._id, job._id, entry._id, {}, true)],
  ['application deletion', () => deleteJob(user._id, job._id)],
  ['archive', () => archiveJob(user._id, job._id, true)],
  ['Offer', () => updateJob(user._id, job._id, { status: 'offer' })],
  ['rejection', () => updateJob(user._id, job._id, { status: 'rejected' })],
  ['read', () => act('read')], ['cancel', () => act('cancel')],
  ['reminders disabled', () => saveReminderSettings(user._id, { enabled: false })],
]) test(`${name} prevents old reminders from being sent`, async () => {
  await register(); await mutate(); assert.equal((await run()).attempted, 0);
});
test('snooze suppresses delivery until due and sends only once for that snooze', async () => {
  await register(); assert.equal((await run()).sent, 1);
  await act('snooze'); assert.equal((await run()).sent, 0);
  assert.equal((await run({ clock: () => now + 600000 })).sent, 1);
  assert.equal((await run({ clock: () => now + 660000 })).sent, 0);
});
test('missing dates, future windows and expired events cannot push', async () => {
  await register();
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(61) }); assert.equal((await run()).sent, 0);
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(-1) }); assert.equal((await run()).sent, 0);
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: null }); assert.equal((await run()).sent, 0);
});
test('logout, session expiry, password reset and user deletion stop delivery', async () => {
  await register(); await revokeDevice({ installationKey: key, sequence: 2 }, now); assert.equal((await run()).sent, 0);
  await register({ sequence: 3 }); assert.equal((await run({ clock: () => now + 121 * 60000 })).sent, 0);
  await User.updateOne({ _id: user._id }, { $inc: { authVersion: 1 } }); assert.equal((await run()).sent, 0);
  await assert.rejects(register({ sequence: 4 }), status(401));
  await register({ sequence: 4 }, { ...identity, authVersion: 1 }); await User.deleteOne({ _id: user._id }); assert.equal((await run()).sent, 0);
});
test('foreign users, other installations and old bindings cannot resolve a notification', async () => {
  await register(); await run(); const delivery = await PushDelivery.findOne().lean();
  const payload = { installationKey: key, sequence: 1, deliveryId: delivery._id };
  await assert.rejects(resolveNotification({ ...identity, userId: String(other._id) }, payload, now), status(409));
  await assert.rejects(resolveNotification(identity, { ...payload, installationKey: 'c'.repeat(64) }, now), status(409));
  await register({ sequence: 2 }); await assert.rejects(resolveNotification(identity, payload, now), status(409));
});
test('only explicit temporary rejections retry, with backoff and three-attempt bound', async () => {
  await register(); let calls = 0;
  const send = async () => { calls++; return { status: 'retry' }; };
  await run({ send }); await run({ send }); assert.equal(calls, 1);
  await run({ send, clock: () => now + 60000 });
  await run({ send, clock: () => now + 180000 });
  await run({ send, clock: () => now + 400000 }); assert.equal(calls, 3);
});
test('transport timeout/ambiguous outcome is never replayed', async () => {
  await register(); await run({ send: async () => { throw new Error('simulated timeout'); } });
  assert.equal((await PushDelivery.findOne()).status, 'unknown'); assert.equal((await run()).attempted, 0);
});
test('stale crash claims are marked unknown, never retried', async () => {
  await register(); await run();
  await PushDelivery.updateMany({}, { $set: { status: 'sending', updatedAt: new Date(now - 180000) } });
  assert.equal((await run()).attempted, 0); assert.equal((await PushDelivery.findOne()).status, 'unknown');
});
test('invalid APNs token disables only the binding used for that request', async () => {
  await register(); await run({ send: async () => ({ status: 'rejected', invalidateDevice: true }) });
  assert.equal((await PushDevice.findOne()).active, false);
  await register({ sequence: 2 });
  await changeHistory(user._id, job._id, entry._id, { scheduledTime: at(40) });
  await run({ send: async () => { await register({ sequence: 3, token: 'c'.repeat(64) }); return { status: 'rejected', invalidateDevice: true }; } });
  assert.equal((await PushDevice.findOne()).active, true);
});
test('mutation during APNs IO invalidates delivery and tapping does not open old data', async () => {
  await register();
  const result = await run({ send: async () => { await changeHistory(user._id, job._id, entry._id, { scheduledTime: null }); return { status: 'sent' }; } });
  assert.equal(result.cancelled, 1);
  const delivery = await PushDelivery.findOne().lean();
  await assert.rejects(resolveNotification(identity, { installationKey: key, sequence: 1, deliveryId: delivery._id }, now), status(409));
});
test('appointment and deadline are independent and device pagination continues', async () => {
  await changeHistory(user._id, job._id, entry._id, { deadline: at(40) });
  await register(); await register({ installationKey: 'c'.repeat(64), token: 'd'.repeat(64) });
  assert.equal((await run({ maxDevices: 1 })).sent, 2);
  assert.equal((await run({ maxDevices: 1 })).sent, 2);
  assert.equal((await run({ maxDevices: 1 })).sent, 0);
});
test('send-budget continuation does not lose remaining reminders on the same device', async () => {
  await changeHistory(user._id, job._id, entry._id, { deadline: at(40) }); await register();
  assert.equal((await run({ maxSends: 1 })).sent, 1);
  assert.equal((await run({ maxSends: 1 })).sent, 1);
});
test('HTTP/2 transport sends signed generic alerts, no offline queue, and classifies responses', async () => {
  await register(); const device = await PushDevice.findOne().select('+token').lean();
  const delivery = { _id: 'c'.repeat(64) }, reminder = { id: `${entry._id}:appointment:0`, historyId: String(entry._id), kind: 'appointment' };
  const payload = notificationPayload(device, delivery, reminder);
  assert.ok(!JSON.stringify(payload).includes(job.company)); assert.ok(!JSON.stringify(payload).includes(job.position));
  const server = createServer(); let responseStatus = 200, reason = '';
  server.on('stream', (stream, headers) => {
    assert.equal(headers['apns-expiration'], '0'); assert.equal(headers['apns-push-type'], 'alert');
    assert.equal(headers['apns-topic'], config.topic); assert.ok(headers.authorization.startsWith('bearer '));
    assert.equal(headers['apns-collapse-id'], hash(`${device._id}:${device.userId}:${entry._id}:appointment`));
    let data = ''; stream.on('data', chunk => { data += chunk; });
    stream.on('end', () => { assert.deepEqual(JSON.parse(data), payload); stream.respond({ ':status': responseStatus }); stream.end(reason ? JSON.stringify({ reason }) : ''); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = () => connect(`http://127.0.0.1:${server.address().port}`);
  try {
    assert.equal((await sendAPNs(config, device, delivery, reminder, { transport })).status, 'sent');
    responseStatus = 503; assert.equal((await sendAPNs(config, device, delivery, reminder, { transport })).status, 'retry');
    responseStatus = 410; reason = 'Unregistered'; assert.equal((await sendAPNs(config, device, delivery, reminder, { transport })).invalidateDevice, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('HTTP handlers enforce auth, origin, bounded JSON, cron secret and safe failures', async () => {
  const handler = (action, options = {}) => createPushHandler({ action, authenticate: async () => ({ ...identity, expires: new Date(Date.now() + 3600000).toISOString() }), connect: async () => {}, env: () => env, limit: async () => true, ...options });
  const request = (data, headers = {}) => new Request('https://example.test/api/push/register', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://example.test', ...headers }, body: JSON.stringify(data) });
  assert.equal((await handler('register', { authenticate: async () => null })(request(body()))).status, 401);
  assert.equal((await handler('register')(request(body(), { Origin: 'https://evil.test' }))).status, 403);
  assert.equal((await handler('register')(request({ ...body(), token: 'x'.repeat(5000) }))).status, 413);
  assert.equal((await handler('register')(request(body(), { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handler('register', { limit: async () => false })(request(body()))).status, 429);
  const success = await handler('register')(request(body())); assert.equal(success.status, 200); assert.equal(success.headers.get('cache-control'), 'private, no-store');
  const revoked = await handler('revoke', { authenticate: async () => { throw new Error('must not authenticate revoke'); } })(request({ installationKey: key, sequence: 2 })); assert.equal(revoked.status, 200);
  const cron = handler('cron', { worker: async () => ({ sent: 1 }) });
  assert.equal((await cron(new Request('https://example.test/api/push/cron'))).status, 401);
  assert.equal((await cron(new Request('https://example.test/api/push/cron', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }))).status, 200);
  assert.equal((await handler('cron', { env: () => ({ ...env, PUSH_ENABLED: '' }) })(new Request('https://example.test/api/push/cron', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }))).status, 503);
  const failed = await handler('register', { connect: async () => { throw new Error(token); } })(request(body()));
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes(token));
});
