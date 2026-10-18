import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import AuthRateLimit from '../lib/models/AuthRateLimit.js';
import { requestPasswordReset, resetPassword, resetTokenHash, RESET_MESSAGE } from '../lib/auth/passwordReset.js';
import { consumeAuthLimit } from '../lib/auth/rateLimit.js';
import { normalizeEmail, validateNewPassword } from '../lib/auth/validation.js';
import { resetDeliveryConfig, sendPasswordReset } from '../lib/auth/resetDelivery.js';
import { createResetHandler } from '../lib/auth/resetHandler.js';
import { startAuthToken, validAuthToken, SHORT_SESSION_SECONDS, REMEMBERED_SESSION_SECONDS } from '../lib/auth/session.js';

let replica, user;
const origin = 'https://jobgenie.example.test';
async function issue(now = Date.now()) {
  let delivery;
  await requestPasswordReset(user.email, { origin, now, send: async (message) => { delivery = message; } });
  return new URLSearchParams(new URL(delivery.url).hash.slice(1)).get('token');
}
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User.init(), AuthRateLimit.init()]);
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), AuthRateLimit.deleteMany({})]);
  user = await User.create({ email: 'owner@example.test', password: await bcrypt.hash('original-password', 4) });
});

test('normalizes emails and validates passwords including bcrypt byte boundary', () => {
  assert.equal(normalizeEmail(' OWNER@EXAMPLE.TEST '), user.email);
  for (const value of [null, {}, 'bad', 'a@', 'a\nb@example.test']) assert.throws(() => normalizeEmail(value));
  for (const value of [null, 1234, 'short', 'a'.repeat(73), '密'.repeat(25)]) assert.throws(() => validateNewPassword(value));
  assert.equal(validateNewPassword('密'.repeat(24)), '密'.repeat(24));
});

test('stores only a secret hash and delivers a trusted-origin fragment link', async () => {
  const token = await issue();
  const saved = await User.findById(user._id).select('+passwordResetHash +passwordResetExpiresAt');
  assert.equal(saved.passwordResetHash, resetTokenHash(token.split('.')[1]));
  assert.equal(JSON.stringify(saved).includes(token), false);
  assert.ok(saved.passwordResetExpiresAt > new Date());
  assert.equal((await User.findById(user._id).lean()).passwordResetHash, undefined);
});

test('known and unknown addresses have the same response; cooldown and per-hour cap limit sends', async () => {
  let sends = 0;
  const now = Date.now();
  const options = { origin, now, send: async () => { sends++; } };
  const known = await requestPasswordReset(' OWNER@EXAMPLE.TEST ', options);
  const unknown = await requestPasswordReset('missing@example.test', options);
  assert.deepEqual(known, unknown); assert.equal(known.message, RESET_MESSAGE);
  await requestPasswordReset(user.email, options);
  assert.equal(sends, 1);
  const bucketStart = Math.floor(now / 3600000) * 3600000 + 3600000;
  await AuthRateLimit.deleteMany({});
  for (let minute = 0; minute < 8; minute++) await requestPasswordReset(user.email, { ...options, now: bucketStart + minute * 61000 });
  assert.equal(sends, 6);
});

test('atomic distributed throttle does not let concurrent requests exceed the cap', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => consumeAuthLimit('test-concurrent', 3, 60000)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await AuthRateLimit.countDocuments(), 1);
});

test('successful reset changes password, consumes link and revokes existing sessions', async () => {
  const oldSession = startAuthToken({}, { id: String(user._id), authVersion: 0, rememberMe: true });
  const token = await issue();
  await resetPassword(token, 'replacement-password');
  const current = await User.findById(user._id).select('+passwordResetHash');
  assert.equal(await bcrypt.compare('replacement-password', current.password), true);
  assert.equal(await bcrypt.compare('original-password', current.password), false);
  assert.equal(current.passwordResetHash, undefined);
  assert.equal(current.authVersion, 1);
  assert.equal(validAuthToken(oldSession, current), false);
  assert.equal(validAuthToken(startAuthToken({}, { id: String(current._id), authVersion: 1 }), current), true);
  await assert.rejects(resetPassword(token, 'second-password'), /invalid or expired/);
});

test('expired, malformed, forged and cross-user reset links cannot change passwords', async () => {
  const now = Date.now();
  const token = await issue(now);
  const otherId = new mongoose.Types.ObjectId();
  for (const candidate of [null, {}, token.replace(String(user._id), String(otherId)), `${user._id}.${'f'.repeat(64)}`]) {
    await assert.rejects(resetPassword(candidate, 'replacement-password'), /invalid or expired/);
  }
  await assert.rejects(resetPassword(token, 'replacement-password', { now: now + 30 * 60000 }), /invalid or expired/);
  assert.equal(await bcrypt.compare('original-password', (await User.findById(user._id)).password), true);
});

test('new reset request invalidates old link and concurrent consumption has one winner', async () => {
  const now = Date.now();
  const old = await issue(now);
  const fresh = await issue(now + 61000);
  await assert.rejects(resetPassword(old, 'replacement-password'), /invalid or expired/);
  const results = await Promise.allSettled([resetPassword(fresh, 'first-password'), resetPassword(fresh, 'second-password')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await User.findById(user._id)).authVersion, 1);
});

test('delivery failure does not expose account details or leave a valid token', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const response = await requestPasswordReset(user.email, { origin, send: async () => { throw new Error('secret-provider-detail'); } });
  assert.deepEqual(response, { message: RESET_MESSAGE });
  assert.equal((await User.findById(user._id).select('+passwordResetHash')).passwordResetHash, undefined);
  assert.equal(JSON.stringify(log.mock.calls).includes('secret-provider-detail'), false);
});

test('remember me sets fixed 12-hour or 30-day expiry and rejects revoked/deleted sessions', () => {
  const now = Date.now();
  const short = startAuthToken({}, { id: String(user._id) }, now);
  const long = startAuthToken({}, { id: String(user._id), rememberMe: true }, now);
  assert.equal(short.authExpiresAt - Math.floor(now / 1000), SHORT_SESSION_SECONDS);
  assert.equal(long.authExpiresAt - Math.floor(now / 1000), REMEMBERED_SESSION_SECONDS);
  assert.equal(validAuthToken(short, user, now + SHORT_SESSION_SECONDS * 1000), false);
  assert.equal(validAuthToken(long, user, now + SHORT_SESSION_SECONDS * 1000), true);
  assert.equal(validAuthToken(long, null, now), false);
  assert.equal(validAuthToken(long, { authVersion: 1 }, now), false);
  assert.equal(validAuthToken({ exp: Math.floor(now / 1000) + 10 }, user, now), true);
  assert.equal(validAuthToken({ exp: Math.floor(now / 1000) + 10 }, { authVersion: 1 }, now), false);
});

test('delivery requires explicit configuration and ignores request-controlled origins', async () => {
  for (const env of [{}, { NEXTAUTH_URL: 'javascript:alert(1)' }, { NEXTAUTH_URL: 'http://evil.test', RESEND_API_KEY: 'test', PASSWORD_RESET_FROM: 'from@example.test' }]) {
    assert.throws(() => resetDeliveryConfig(env), { status: 503 });
  }
  const config = resetDeliveryConfig({ NEXTAUTH_URL: origin, RESEND_API_KEY: 'test', PASSWORD_RESET_FROM: 'from@example.test' });
  let request;
  await sendPasswordReset({ email: user.email, url: `${origin}/reset-password#token=test` }, config, async (...args) => { request = args; return { ok: true }; });
  assert.equal(request[0], 'https://api.resend.com/emails');
  const body = JSON.parse(request[1].body);
  assert.deepEqual(body.to, [user.email]); assert.match(body.text, /30 minutes/);
  await assert.rejects(sendPasswordReset({ email: user.email, url: origin }, config, async () => ({ ok: false })), /delivery failed/);
});

test('HTTP handlers reject bad input, cross-origin writes and unavailable service without leaking details', async () => {
  const handler = createResetHandler({ connect: async () => {}, action: 'request', config: () => resetDeliveryConfig({}) });
  const req = (body, headers = {}) => new Request(`${origin}/api/auth/forgot-password`, { method: 'POST', body, headers });
  assert.equal((await handler(req('{}', { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await handler(req('invalid'))).status, 400);
  assert.equal((await handler(req('{}'))).status, 503);
  const broken = createResetHandler({ action: 'reset', connect: async () => { throw new Error('private DB URL'); } });
  const response = await broken(req('{}'));
  assert.equal(response.status, 500); assert.equal((await response.text()).includes('private'), false);
});

test('HTTP recovery flow is testable with a fake sender and rejects invalid reset bodies', async () => {
  let link;
  const request = (body) => new Request(`${origin}/api/auth/forgot-password`, { method: 'POST', body: JSON.stringify(body) });
  const handler = createResetHandler({ connect: async () => {}, action: 'request', config: () => ({ origin }), send: async ({ url }) => { link = url; } });
  const response = await handler(request({ email: user.email }));
  assert.equal(response.status, 200); assert.ok(link.startsWith(origin));
  const reset = createResetHandler({ connect: async () => {}, action: 'reset' });
  assert.equal((await reset(request({ token: {}, password: 'replacement-password' }))).status, 400);
  assert.equal((await reset(request({ token: new URLSearchParams(new URL(link).hash.slice(1)).get('token'), password: 'replacement-password' }))).status, 200);
});

test('origin validation uses the configured public URL behind Next.js proxies', async () => {
  const { isSameOriginRequest } = await import('../lib/auth/requestOrigin.js');
  const request = (headers) => new Request('http://localhost:3000/api/mail', { headers });
  assert.equal(isSameOriginRequest(request({ origin }), origin), true);
  assert.equal(isSameOriginRequest(request({ origin: 'https://evil.test', 'x-forwarded-host': 'evil.test' }), origin), false);
  assert.equal(isSameOriginRequest(request({ 'sec-fetch-site': 'cross-site' }), origin), false);
});
