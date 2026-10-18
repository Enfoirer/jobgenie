import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import MailAccount from '../lib/models/MailAccount.js';
import OAuthAttempt from '../lib/models/OAuthAttempt.js';
import AuthRateLimit from '../lib/models/AuthRateLimit.js';
import { issueOAuthAttempt, consumeOAuthAttempt, oauthHash, stateCookie } from '../lib/oauth/state.js';
import { providerConfig, authorizationUrl, exchangeMailbox, publicOrigin } from '../lib/oauth/providers.js';
import { createOAuthHandler, saveMailbox } from '../lib/oauth/routeHandler.js';
import { createCredentialsAuthorizer, credentialErrorResponse } from '../lib/auth/credentials.js';
import { createRegisterHandler } from '../lib/auth/registerHandler.js';
import { checkAttemptLimit, checkIpAttempts } from '../lib/auth/attemptLimits.js';
import { clientIp } from '../lib/auth/clientIp.js';
import { startAuthToken, sessionBinding } from '../lib/auth/session.js';

let replica, user, identity;
const env = { NEXTAUTH_URL: 'https://jobgenie.example.test', GOOGLE_CLIENT_ID: 'google-test-id', GOOGLE_CLIENT_SECRET: 'google-test-secret', OUTLOOK_CLIENT_ID: 'outlook-test-id', OUTLOOK_CLIENT_SECRET: 'outlook-test-secret' };
const origin = env.NEXTAUTH_URL;
const mailbox = (provider = 'google') => ({ provider: provider === 'google' ? 'gmail' : 'outlook', emailAddress: 'mailbox@example.test', accessToken: 'private-test-token', refreshToken: 'private-test-refresh' });
const startRequest = (provider = 'google', headers = {}) => new Request(`${origin}/api/oauth/${provider}/start`, { method: 'POST', headers });
const callbackRequest = (provider, state, cookie, extra = { code: 'test-code' }) => new Request(`${origin}/api/oauth/${provider}/callback?${new URLSearchParams({ state, ...extra })}`, { headers: { cookie } });
const route = (provider, action, overrides = {}) => createOAuthHandler({ provider, action, authenticate: async () => identity, connect: async () => {}, env: () => env, exchange: async () => mailbox(provider), ...overrides });
async function begin(provider = 'google') {
  const response = await route(provider, 'start')(startRequest(provider));
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).url);
  return { state: url.searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0], url, response };
}
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri()); await Promise.all([User, MailAccount, OAuthAttempt, AuthRateLimit].map((model) => model.init()));
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all([User, MailAccount, OAuthAttempt, AuthRateLimit].map((model) => model.deleteMany({})));
  user = await User.create({ email: 'owner@example.test', password: await bcrypt.hash('test-password', 4) });
  identity = { userId: String(user._id), sessionId: 'session-one' };
});

for (const provider of ['google', 'outlook']) {
  test(`${provider}: start creates hashed, expiring, browser/session-bound state and S256 challenge`, async () => {
    const { state, cookie, url, response } = await begin(provider);
    assert.match(state, /^[\w-]{43}$/); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const verifier = cookie.split('=')[1];
    assert.notEqual(state, verifier); assert.ok(url.searchParams.get('code_challenge'));
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/', 'Max-Age=600']) assert.ok(response.headers.get('set-cookie').includes(flag));
    assert.match(cookie, /^__Host-/);
    const saved = await OAuthAttempt.findOne().lean();
    assert.equal(saved.stateHash, oauthHash(state)); assert.equal(saved.browserHash, oauthHash(verifier));
    assert.equal(JSON.stringify(saved).includes(state), false); assert.equal(JSON.stringify(saved).includes(verifier), false);
    assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/oauth/${provider}/callback`);
  });
  test(`${provider}: valid callback saves mailbox once, clears cookie and rejects replay before exchange`, async () => {
    const { state, cookie } = await begin(provider); let exchanges = 0;
    const callback = route(provider, 'callback', { exchange: async () => { exchanges++; return mailbox(provider); } });
    const result = await callback(callbackRequest(provider, state, cookie));
    assert.equal(result.status, 303); assert.equal(new URL(result.headers.get('location')).searchParams.get('connected'), mailbox(provider).provider);
    assert.match(result.headers.get('set-cookie'), /Max-Age=0/); assert.equal(await MailAccount.countDocuments(), 1);
    const replay = await callback(callbackRequest(provider, state, cookie));
    assert.match(replay.headers.get('location'), /invalid_state/); assert.equal(exchanges, 1);
    assert.equal(await MailAccount.countDocuments(), 1);
  });
  test(`${provider}: consent denial still consumes valid state without exchanging tokens`, async () => {
    const { state, cookie } = await begin(provider);
    const callback = route(provider, 'callback', { exchange: async () => { throw new Error('should not run'); } });
    const result = await callback(callbackRequest(provider, state, cookie, { error: 'access_denied' }));
    assert.match(result.headers.get('location'), /cancelled/); assert.equal(await OAuthAttempt.countDocuments(), 0);
    assert.equal(await MailAccount.countDocuments(), 0);
  });
}

test('missing/tampered/duplicate state or wrong cookie cannot exchange codes or consume a legitimate attempt', async () => {
  const { state, cookie } = await begin(); let exchanges = 0;
  const callback = route('google', 'callback', { exchange: async () => { exchanges++; return mailbox(); } });
  for (const request of [callbackRequest('google', '', cookie), callbackRequest('google', 'a'.repeat(43), cookie), callbackRequest('google', state, ''), callbackRequest('google', state, cookie + '; ' + cookie), new Request(`${origin}/api/oauth/google/callback?state=${state}&state=${state}&code=test`, { headers: { cookie } })]) {
    assert.match((await callback(request)).headers.get('location'), /invalid_state/);
  }
  assert.equal(exchanges, 0); assert.equal(await OAuthAttempt.countDocuments(), 1);
});

test('state cannot cross providers, users, login sessions or expiry, including delayed TTL cleanup', async () => {
  const { state, verifier } = await issueOAuthAttempt(identity, 'google');
  for (const [owner, provider] of [[identity, 'outlook'], [{ ...identity, userId: String(new mongoose.Types.ObjectId()) }, 'google'], [{ ...identity, sessionId: 'new-login' }, 'google']]) {
    await assert.rejects(consumeOAuthAttempt(owner, provider, state, verifier), { status: 400 });
  }
  await OAuthAttempt.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(consumeOAuthAttempt(identity, 'google', state, verifier), { status: 400 });
});

test('starting again invalidates previous same-provider flow but keeps other providers independent', async () => {
  const previous = await issueOAuthAttempt(identity, 'google');
  const outlook = await issueOAuthAttempt(identity, 'outlook');
  const fresh = await issueOAuthAttempt(identity, 'google');
  await assert.rejects(consumeOAuthAttempt(identity, 'google', previous.state, previous.verifier), { status: 400 });
  await consumeOAuthAttempt(identity, 'google', fresh.state, fresh.verifier);
  await consumeOAuthAttempt(identity, 'outlook', outlook.state, outlook.verifier);
});

test('concurrent callbacks claim the state once and issue only one token exchange', async () => {
  const { state, cookie } = await begin(); let exchanges = 0;
  const callback = route('google', 'callback', { exchange: async () => { exchanges++; return mailbox(); } });
  const responses = await Promise.all(Array.from({ length: 6 }, () => callback(callbackRequest('google', state, cookie))));
  assert.equal(exchanges, 1); assert.equal(responses.filter((r) => r.headers.get('location').includes('connected=')).length, 1);
  assert.equal(await MailAccount.countDocuments(), 1);
});

test('provider failures never echo codes, secrets or upstream payloads and cannot replay', async () => {
  const { state, cookie } = await begin();
  const callback = route('google', 'callback', { exchange: async () => { throw new Error('private-token private-code secret'); } });
  const response = await callback(callbackRequest('google', state, cookie));
  assert.equal(response.headers.get('location'), `${origin}/dashboard/mail?oauth_error=failed`);
  assert.equal(await response.text(), ''); assert.equal(await OAuthAttempt.countDocuments(), 0);
});

test('session revoked during provider exchange prevents mailbox persistence', async () => {
  const { state, cookie } = await begin(); let current = identity;
  const response = await route('google', 'callback', { authenticate: async () => current, exchange: async () => { current = null; return mailbox(); } })(callbackRequest('google', state, cookie));
  assert.match(response.headers.get('location'), /session_expired/); assert.equal(await MailAccount.countDocuments(), 0);
});

test('OAuth start requires login and same origin, limits attempts and fails closed on storage errors', async () => {
  assert.equal((await route('google', 'start', { authenticate: async () => null })(startRequest())).status, 401);
  assert.equal((await route('google', 'start')(startRequest('google', { origin: 'https://evil.test' }))).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await route('google', 'start')(startRequest())).status, 200);
  const limited = await route('google', 'start')(startRequest());
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '600');
  assert.equal((await route('google', 'start', { connect: async () => { throw new Error('private-db'); } })(startRequest())).status, 503);
});

test('binding existing mailboxes preserves refresh tokens/cursors and serializes concurrent creates', async () => {
  const existing = await MailAccount.create({ ...mailbox(), userId: user._id, metadata: { historyId: 'cursor' } });
  await saveMailbox(String(user._id), { provider: 'gmail', emailAddress: existing.emailAddress, accessToken: 'new-token' });
  const updated = await MailAccount.findById(existing._id);
  assert.equal(updated.refreshToken, 'private-test-refresh'); assert.equal(updated.metadata.historyId, 'cursor');
  await Promise.all([saveMailbox(String(user._id), mailbox('outlook')), saveMailbox(String(user._id), mailbox('outlook'))]);
  assert.equal(await MailAccount.countDocuments({ userId: user._id, provider: 'outlook' }), 1);
});

test('provider exchange sends correct verifier/redirect and resolves only fixed provider endpoints', async () => {
  for (const provider of ['google', 'outlook']) {
    const config = providerConfig(provider, env), calls = [];
    const result = await exchangeMailbox(config, 'authorization-code', 'private-verifier', async (url, options) => {
      calls.push({ url, options });
      return Response.json(calls.length === 1 ? { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: config.scope } : provider === 'google' ? { emailAddress: ' MAILBOX@EXAMPLE.TEST ' } : { mail: ' MAILBOX@EXAMPLE.TEST ' });
    });
    assert.equal(result.emailAddress, 'mailbox@example.test'); assert.equal(calls[0].url, config.tokenUrl);
    assert.equal(calls[0].options.body.get('code_verifier'), 'private-verifier'); assert.equal(calls[0].options.body.get('redirect_uri'), config.redirectUri);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer test-access'); assert.equal(calls[1].options.redirect, 'error');
    assert.equal(authorizationUrl(config, { state: 'state', challenge: 'challenge' }).includes(config.clientSecret), false);
  }
});

test('untrusted origins/tenants, invalid tokens/profiles and missing mail permissions are rejected', async () => {
  assert.throws(() => publicOrigin({ NEXTAUTH_URL: 'https://user:pass@evil.test' }));
  assert.throws(() => providerConfig('outlook', { ...env, OUTLOOK_TENANT_ID: '../evil' }));
  assert.throws(() => providerConfig('google', { NEXTAUTH_URL: origin }));
  assert.match(stateCookie('google', 'http://127.0.0.1:3000', 'test'), /^jobgenie-oauth-google=/);
  const config = providerConfig('google', env);
  for (const tokens of [{ access_token: {} }, { access_token: 'ok', scope: 'openid email' }, { access_token: 'ok', expires_in: -1 }]) {
    let calls = 0;
    await assert.rejects(exchangeMailbox(config, 'code', 'verifier', async () => Response.json(++calls === 1 ? tokens : { emailAddress: 'mailbox@example.test' })));
  }
});

test('trusted IP parsing ignores spoofable headers and normalizes IPv6', () => {
  const request = (headers) => new Request(origin, { headers });
  assert.equal(clientIp(request({ 'x-forwarded-for': '192.0.2.1' }), false), 'anonymous');
  assert.equal(clientIp(request({ 'x-vercel-forwarded-for': '192.0.2.1' }), false), 'anonymous');
  assert.equal(clientIp(request({ 'x-vercel-forwarded-for': '192.0.2.1' }), true), '192.0.2.1');
  assert.equal(clientIp(request({ 'x-vercel-forwarded-for': 'one,two' }), true), 'anonymous');
  assert.equal(clientIp(request({ 'x-vercel-forwarded-for': '2001:0db8:0:0::1' }), true), '[2001:db8::1]');
});

test('login email limiter includes successful attempts, normalizes casing and blocks before password work', async () => {
  let comparisons = 0;
  const authorize = createCredentialsAuthorizer({ connect: async () => {}, compare: async () => { comparisons++; return true; } });
  for (let i = 0; i < 10; i++) assert.ok(await authorize({ email: i % 2 ? ' OWNER@EXAMPLE.TEST ' : user.email, password: 'test-password' }, {}));
  await assert.rejects(authorize({ email: user.email, password: 'test-password' }, {}), /AUTH_RATE_LIMITED_/);
  assert.equal(comparisons, 10);
});

test('concurrent login attempts cannot pass the account quota and unknown users share the same limit behavior', async () => {
  const authorize = createCredentialsAuthorizer({ connect: async () => {}, compare: async () => false });
  const results = await Promise.allSettled(Array.from({ length: 18 }, () => authorize({ email: 'unknown@example.test', password: 'test-password' }, {})));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => /AUTH_RATE_LIMITED_/.test(r.reason.message)));
});

test('login rejects bad credentials and fails closed when the limiter is unavailable', async () => {
  const authorize = createCredentialsAuthorizer({ connect: async () => {} });
  assert.equal(await authorize({ email: user.email, password: 'wrong-password' }, {}), null);
  assert.equal(await authorize({ email: 'missing@example.test', password: 'wrong-password' }, {}), null);
  assert.equal(await authorize({ email: {}, password: 'x' }, {}), null);
  const broken = createCredentialsAuthorizer({ connect: async () => {}, checkIp: async () => { throw new Error('private-db'); } });
  await assert.rejects(broken({ email: user.email, password: 'test-password' }, {}), /^Error: AUTH_UNAVAILABLE$/);
});

test('IP limit cannot be bypassed by changing email and quotas recover in the next fixed window', async () => {
  const now = 900000 * 1000 + 1000;
  for (let i = 0; i < 50; i++) await checkIpAttempts('login', {}, { now });
  await assert.rejects(checkIpAttempts('login', {}, { now }), { status: 429 });
  await checkIpAttempts('login', {}, { now: now + 900000 });
  for (let i = 0; i < 3; i++) await checkAttemptLimit('register', 'email', user.email, { now });
  await assert.rejects(checkAttemptLimit('register', 'email', user.email, { now }), (error) => error.status === 429 && error.retryAfter > 0);
});

test('NextAuth adapter restores 429/Retry-After or 503 and preserves cookies and response JSON', async () => {
  for (const [code, status] of [['AUTH_RATE_LIMITED_42', 429], ['AUTH_UNAVAILABLE', 503], ['CredentialsSignin', 401]]) {
    const original = Response.json({ url: `${origin}/api/auth/error?error=${code}` }, { status: 401, headers: { 'Set-Cookie': 'sample=test; HttpOnly' } });
    const response = await credentialErrorResponse(original);
    assert.equal(response.status, status); assert.equal(response.headers.get('set-cookie'), 'sample=test; HttpOnly');
    if (status === 429) assert.equal(response.headers.get('retry-after'), '42');
    assert.equal((await response.json()).url, `${origin}/api/auth/error?error=${code}`);
  }
});

const registration = (body, headers = {}) => new Request(`${origin}/api/auth/register`, { method: 'POST', body: JSON.stringify(body), headers });
test('registration validates, normalizes email, hashes passwords and never returns password fields', async () => {
  const handler = createRegisterHandler({ connect: async () => {} });
  const response = await handler(registration({ email: ' NEW@EXAMPLE.TEST ', password: 'new-password', name: 'New Person' }));
  assert.equal(response.status, 201);
  const body = await response.json(); assert.equal(body.user.email, 'new@example.test'); assert.equal(body.user.password, undefined);
  const saved = await User.findById(body.user.id); assert.equal(await bcrypt.compare('new-password', saved.password), true);
  assert.equal((await handler(registration({ email: saved.email, password: 'new-password' }))).status, 409);
});

test('registration throttles existing/unknown emails, invalid requests and IPs before hashing or creating', async () => {
  const handler = createRegisterHandler({ connect: async () => {} });
  for (let i = 0; i < 3; i++) assert.equal((await handler(registration({ email: 'new@example.test', password: 'short' }))).status, 400);
  const limited = await handler(registration({ email: ' NEW@EXAMPLE.TEST ', password: 'new-password' }));
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  for (let i = 0; i < 6; i++) await handler(registration({ email: `different-${i}@example.test`, password: 'short' }));
  assert.equal((await handler(registration({ email: 'different@example.test', password: 'new-password' }))).status, 429);
  assert.equal(await User.countDocuments(), 1);
});

test('registration blocks cross-origin/oversized/protected payloads and concurrent duplicate signup', async () => {
  const handler = createRegisterHandler({ connect: async () => {} });
  assert.equal((await handler(registration({}, { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await handler(registration({ email: 'x'.repeat(5000) }))).status, 413);
  assert.equal((await handler(registration({ email: 'new@example.test', password: 'new-password', authVersion: 7 }))).status, 400);
  const results = await Promise.all([handler(registration({ email: 'new@example.test', password: 'new-password' })), handler(registration({ email: 'new@example.test', password: 'new-password' }))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});

test('session binding is stable for refreshes but different for separate logins', () => {
  const first = startAuthToken({}, { id: String(user._id) });
  const second = startAuthToken({}, { id: String(user._id) });
  assert.notEqual(sessionBinding(first), sessionBinding(second));
  assert.equal(sessionBinding(first), sessionBinding({ ...first, jti: 'changed' }));
  assert.equal(sessionBinding({ id: String(user._id), authExpiresAt: 100, jti: 'one' }), sessionBinding({ id: String(user._id), authExpiresAt: 100, jti: 'two' }));
});
