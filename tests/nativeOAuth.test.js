import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createNativeOAuthHandler, nativeChallenge } from '../lib/oauth/native.js';
import NativeOAuthAttempt from '../lib/models/NativeOAuthAttempt.js';
import AuthRateLimit from '../lib/models/AuthRateLimit.js';
import { oauthHash } from '../lib/oauth/state.js';

let replica;
const identity = { userId: new mongoose.Types.ObjectId().toString(), sessionId: 'test-session' };
const env = () => ({ NEXTAUTH_URL: 'https://example.test', GOOGLE_CLIENT_ID: 'google-test', GOOGLE_CLIENT_SECRET: 'test-only', OUTLOOK_CLIENT_ID: 'outlook-test', OUTLOOK_CLIENT_SECRET: 'test-only' });
const verifier = 'a'.repeat(43), challenge = nativeChallenge(verifier);
let saved, exchanges;
const exchange = async (config, code, proof) => { exchanges++; assert.equal(code, 'provider-code'); assert.equal(proof, verifier); return { provider: config.provider === 'google' ? 'gmail' : 'outlook', emailAddress: 'mail@example.test' }; };
const handler = (provider, action, extra = {}) => createNativeOAuthHandler({ provider, action, env, authenticate: async () => identity, connect: async () => {}, exchange, save: async (userId, mailbox) => { saved.push({ userId, mailbox }); }, ...extra });
const post = (body, origin = 'https://example.test') => new Request('https://example.test/api/native', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const callback = (state, query = 'code=provider-code') => new Request(`https://example.test/api/oauth/google/callback?state=${state}&${query}`);
const start = async (provider = 'google') => { const response = await handler(provider, 'start')(post({ challenge })); assert.equal(response.status, 200); return response.json(); };
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(replica.getUri());
  await Promise.all([NativeOAuthAttempt.init(), AuthRateLimit.init()]);
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => { await Promise.all([NativeOAuthAttempt.deleteMany({}), AuthRateLimit.deleteMany({})]); saved = []; exchanges = 0; });
for (const provider of ['google', 'outlook']) test(`${provider}: PKCE, existing HTTPS callback, native handoff and one-time finish`, async () => {
  const begin = await start(provider), url = new URL(begin.url);
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), `https://example.test/api/oauth/${provider}/callback`);
  assert(!begin.url.includes(verifier));
  let response = await handler(provider, 'callback')(callback(begin.state));
  assert.equal(response.status, 303); assert.equal(saved.length, 0);
  const link = new URL(response.headers.get('location'));
  assert.equal(link.protocol, 'com.enfoirer.jobgenie:'); assert.equal(link.searchParams.get('state'), begin.state);
  assert.deepEqual([...link.searchParams.keys()], ['state']);
  assert.equal((await handler(provider, 'callback')(callback(begin.state))).status, 400);
  response = await handler(provider, 'finish')(post({ state: begin.state, verifier }));
  assert.deepEqual(await response.json(), { outcome: 'connected' }); assert.equal(saved.length, 1);
  assert.equal((await handler(provider, 'finish')(post({ state: begin.state, verifier }))).status, 409);
  assert.equal(exchanges, 1); assert.equal(await NativeOAuthAttempt.countDocuments(), 0);
});
test('authentication and same-origin precede attempt creation', async () => {
  assert.equal((await handler('google', 'start', { authenticate: async () => null })(post({ challenge }))).status, 401);
  assert.equal((await handler('google', 'start')(post({ challenge }, 'https://attacker.test'))).status, 403);
  assert.equal((await handler('google', 'start')(post({ challenge: 'bad' }))).status, 400);
  assert.equal(await NativeOAuthAttempt.countDocuments(), 0);
});
test('wrong owner, session, provider and PKCE proof cannot consume valid attempt', async () => {
  const { state } = await start();
  assert.equal((await handler('outlook', 'callback')(callback(state))).status, 400);
  await handler('google', 'callback')(callback(state));
  for (const alternate of [{ ...identity, userId: new mongoose.Types.ObjectId().toString() }, { ...identity, sessionId: 'other-session' }]) {
    assert.equal((await handler('google', 'finish', { authenticate: async () => alternate })(post({ state, verifier }))).status, 409);
  }
  assert.equal((await handler('google', 'finish')(post({ state, verifier: 'b'.repeat(43) }))).status, 409);
  assert.equal(await NativeOAuthAttempt.countDocuments(), 1); assert.equal(exchanges, 0);
  assert.equal((await handler('google', 'finish')(post({ state, verifier }))).status, 200);
});
test('finish before callback cannot consume attempt; expiry is checked without TTL cleanup', async () => {
  const { state } = await start();
  assert.equal((await handler('google', 'finish')(post({ state, verifier }))).status, 409);
  await NativeOAuthAttempt.updateOne({ _id: oauthHash(state) }, { $set: { expiresAt: new Date(0) } });
  assert.equal((await handler('google', 'callback')(callback(state))).status, 400);
  assert.equal(saved.length, 0);
});
test('duplicate callback parameters and code/error ambiguity rejected', async () => {
  const { state } = await start();
  for (const query of ['code=a&code=b', 'code=a&error=access_denied', `state=${state}&code=a`]) {
    assert.equal((await handler('google', 'callback')(callback(state, query))).status, 400);
  }
  assert.equal((await NativeOAuthAttempt.findById(oauthHash(state))).status, 'awaiting');
});
test('provider denial and App cancellation never bind an account', async () => {
  const first = await start();
  await handler('google', 'callback')(callback(first.state, 'error=access_denied'));
  assert.deepEqual(await (await handler('google', 'finish')(post({ state: first.state, verifier }))).json(), { outcome: 'cancelled' });
  const second = await start();
  assert.equal((await handler('google', 'cancel')(post({ state: second.state, verifier }))).status, 200);
  assert.equal((await handler('google', 'callback')(callback(second.state))).status, 400);
  assert.equal(saved.length, 0); assert.equal(exchanges, 0);
});
test('concurrent completion has at most one exchange and save', async () => {
  const { state } = await start(); await handler('google', 'callback')(callback(state));
  const responses = await Promise.all([1, 2].map(() => handler('google', 'finish')(post({ state, verifier }))));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(saved.length, 1);
});
test('session revocation during exchange prevents persistence; errors do not reveal codes or tokens', async () => {
  const { state } = await start(); await handler('google', 'callback')(callback(state));
  let reads = 0;
  const response = await handler('google', 'finish', { authenticate: async () => ++reads === 1 ? identity : null })(post({ state, verifier }));
  assert.equal(response.status, 401); assert.equal(saved.length, 0);
  const next = await start(); await handler('google', 'callback')(callback(next.state));
  const failed = await handler('google', 'finish', { exchange: async () => { throw new Error('secret-token-provider-code'); } })(post({ state: next.state, verifier }));
  assert.equal(failed.status, 503); assert(!JSON.stringify(await failed.json()).includes('secret-token')); assert.equal(saved.length, 0);
});
test('start rate limit is shared per user', async () => {
  for (let i = 0; i < 10; i++) await start(i % 2 ? 'outlook' : 'google');
  const response = await handler('google', 'start')(post({ challenge }));
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '600');
});
