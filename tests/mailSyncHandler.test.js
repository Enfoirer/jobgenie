import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMailSyncHandler, cronIdentity } from '../lib/pipeline/mailSyncHandler.js';

const request = (query = '', headers = {}) => new Request(`https://jobgenie.example.test/api/mail${query}`, { headers });
function harness(identity) {
  const calls = { connects: 0, queries: [], syncs: [] };
  const response = { totalFetched: 3, processed: 2, failed: 1, pendingReview: 1, accounts: [] };
  const handler = createMailSyncHandler({
    authenticate: async () => identity,
    connect: async () => { calls.connects++; },
    findAccounts: async (query) => { calls.queries.push(query); return ['mail-account']; },
    sync: async (accounts, options) => { calls.syncs.push({ accounts, options }); return response; },
  });
  return { handler, calls, response };
}

test('manual and cron handlers use the same default limit, processing and response shape', async () => {
  const manual = harness({ userId: 'user-1' });
  const cron = harness({});
  const manualResponse = await manual.handler(request());
  const cronResponse = await cron.handler(request());
  assert.equal(manualResponse.status, 200);
  assert.deepEqual(await manualResponse.json(), await cronResponse.json());
  assert.deepEqual(manual.calls.syncs, cron.calls.syncs);
  assert.deepEqual(manual.calls.syncs[0].options, { limit: 10 });
  assert.deepEqual(manual.calls.queries, [{ userId: 'user-1' }]);
  assert.deepEqual(cron.calls.queries, [{}]);
});

test('provider filter and the upper legal limit apply consistently to both entry points', async () => {
  for (const identity of [{ userId: 'user-1' }, {}]) {
    const { handler, calls } = harness(identity);
    const response = await handler(request('?provider=outlook&limit=50'));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.queries, [{ ...identity, provider: 'outlook' }]);
    assert.equal(calls.syncs[0].options.limit, 50);
  }
});

test('invalid parameters return 400 before either entry point touches the database', async () => {
  for (const identity of [{ userId: 'user-1' }, {}]) {
    for (const query of ['?limit=', '?limit=0', '?limit=-1', '?limit=51', '?limit=1.1', '?limit=NaN', '?provider=unknown']) {
      const { handler, calls } = harness(identity);
      assert.equal((await handler(request(query))).status, 400);
      assert.equal(calls.connects, 0);
      assert.equal(calls.syncs.length, 0);
    }
  }
});

test('unauthenticated calls return 401 without connecting, listing or syncing', async () => {
  const { handler, calls } = harness(null);
  assert.equal((await handler(request())).status, 401);
  assert.equal(calls.connects, 0);
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.syncs.length, 0);
});

test('cron requires a configured matching secret and supports bearer or query token', () => {
  assert.equal(cronIdentity(request(), undefined), null);
  assert.equal(cronIdentity(request('?token=anything'), ''), null);
  assert.equal(cronIdentity(request('?token=wrong'), 'secret'), null);
  assert.deepEqual(cronIdentity(request('?token=secret'), 'secret'), {});
  assert.deepEqual(cronIdentity(request('', { Authorization: 'Bearer secret' }), 'secret'), {});
});

test('database errors have the same failure response for both entry points', async () => {
  for (const identity of [{ userId: 'user-1' }, {}]) {
    const handler = createMailSyncHandler({
      authenticate: async () => identity,
      connect: async () => { throw new Error('database offline'); },
    });
    const response = await handler(request());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Failed to sync mail', details: 'database offline' });
  }
});

const post = (body, headers = {}) => new Request('https://jobgenie.example.test/api/mail', { method: 'POST', body: JSON.stringify(body), headers });
test('manual POST scopes a retry to an owned account and uses the shared queue processor', async () => {
  const { handler, calls } = harness({ userId: 'user-1' });
  const id = '0123456789abcdef01234567';
  assert.equal((await handler(post({ action: 'retry', accountId: id }))).status, 200);
  assert.deepEqual(calls.queries, [{ userId: 'user-1', _id: id }]);
  assert.deepEqual(calls.syncs[0].options, { limit: 10, retryOnly: true });
});

test('manual POST rejects invalid bodies and cross-origin requests before database access', async () => {
  for (const body of [null, [], {}, { action: 'delete' }, { action: 'retry', accountId: {} }, { action: 'sync', userId: 'other' }]) {
    const { handler, calls } = harness({ userId: 'user-1' });
    assert.equal((await handler(post(body))).status, 400); assert.equal(calls.connects, 0);
  }
  assert.equal((await harness({ userId: 'user-1' }).handler(post({ action: 'sync' }, { origin: 'https://evil.test' }))).status, 403);
});

test('missing or foreign account returns 404, and manual results contain no raw emails or errors', async () => {
  const handler = createMailSyncHandler({ authenticate: async () => ({ userId: 'owner' }), connect: async () => {}, findAccounts: async () => [] });
  assert.equal((await handler(post({ action: 'retry', accountId: '0123456789abcdef01234567' }))).status, 404);
  const safe = createMailSyncHandler({ authenticate: async () => ({ userId: 'owner' }), connect: async () => {}, findAccounts: async () => ['account'],
    sync: async () => ({ emails: [{ bodyText: 'private' }], errors: [{ accountId: 'account', stage: 'ingest', message: 'private token' }], processed: 0 }) });
  const response = await safe(post({ action: 'sync' }));
  assert.deepEqual(await response.json(), { processed: 0, errors: [{ accountId: 'account', stage: 'ingest' }] });
});
