import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OnboardingClient } from '../lib/onboarding/browserClient.js';
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('failed dismissal saves locally, suppresses a relaunch and retries the account write', async () => {
  const local = storage(); const calls = [];
  const client = new OnboardingClient({ userId: 'owner', storage: local, fetcher: async (_, init) => {
    calls.push(init);
    return init.method ? new Response(null, { status: 503 }) : Response.json({ eligible: true, outcome: null });
  } });
  await client.start(); client.show(); assert.equal(client.state.open, true);
  await client.finish('skipped'); assert.equal(client.state.open, false); assert(client.state.notice);
  assert.equal(local.getItem(client.key), 'skipped'); client.stop();
  const relaunched = new OnboardingClient({ userId: 'owner', storage: local, fetcher: async (_, init) => {
    assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body), { action: 'skipped' });
    return Response.json({ eligible: false, outcome: 'skipped' });
  } });
  await relaunched.start(); relaunched.show();
  assert.equal(relaunched.state.open, false); assert.equal(relaunched.state.notice, ''); assert.equal(local.getItem(client.key), undefined);
  relaunched.stop();
});
test('late eligibility and save replies cannot reopen a dismissed guide or update a stopped account', async () => {
  const lateGet = deferred(), latePost = deferred();
  const client = new OnboardingClient({ userId: 'owner', storage: storage(), fetcher: (_, init) => init.method ? latePost.promise : lateGet.promise });
  const load = client.start(); const save = client.finish('completed');
  lateGet.resolve(Response.json({ eligible: true, outcome: null })); await load;
  client.show(); assert.equal(client.state.open, false);
  client.stop(); const snapshot = client.state;
  latePost.resolve(Response.json({ eligible: false, outcome: 'completed' })); await save;
  assert.equal(client.state, snapshot);
});
test('storage and terminal account state synchronize tabs without crossing accounts', async () => {
  const local = storage(); let serverOutcome = null;
  const owner = new OnboardingClient({ userId: 'owner', storage: local, fetcher: async (_, init) => {
    if (init.method) serverOutcome = JSON.parse(init.body).action;
    return Response.json({ eligible: !serverOutcome, outcome: serverOutcome });
  } });
  await owner.start(); owner.show(); local.setItem(owner.key, 'skipped'); await owner.refresh();
  assert.equal(owner.state.open, false); assert.equal(serverOutcome, 'skipped');
  const other = new OnboardingClient({ userId: 'other', storage: local, fetcher: async () => Response.json({ eligible: true, outcome: null }) });
  await other.start(); other.show(); assert.equal(other.state.open, true);
  owner.stop(); other.stop();
});
test('another device completing onboarding closes an already open guide on refresh', async () => {
  let outcome = null;
  const client = new OnboardingClient({ userId: 'owner', fetcher: async () => Response.json({ eligible: !outcome, outcome }) });
  await client.start(); client.show(); assert.equal(client.state.open, true);
  outcome = 'completed'; await client.refresh(); assert.equal(client.state.open, false); client.stop();
});
test('unavailable storage and failed eligibility reads keep the dashboard usable', async () => {
  let online = false;
  const client = new OnboardingClient({ userId: 'owner', storage: { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } }, fetcher: async (_, init) => {
    if (!online) throw new Error('offline');
    return Response.json(init.method ? { eligible: false, outcome: 'completed' } : { eligible: true, outcome: null });
  } });
  await client.start(); assert.equal(client.state.open, false);
  online = true; await client.refresh(); client.show(); assert.equal(client.state.open, true);
  await client.finish('completed'); assert.equal(client.state.notice, ''); client.stop();
});
