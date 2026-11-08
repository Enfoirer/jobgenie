import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { FeedbackClock, FeedbackClient, SURVEY, validDraft, readPreference } from '../lib/feedback/browserClient.js';

class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}
const status = (fields = {}) => ({ campaign: SURVEY, submitted: false, disabled: false, eligible: true, response: null, invitationId: null, ...fields });
const response = { overall: 1, recommendation: 2, comment: 'Needs work.', source: 'manual', platform: 'web', createdAt: '2030-01-01T00:00:00Z' };
const draft = { overall: 1, recommendation: 2, comment: 'Needs work.' };
function setup(transport, options = {}) {
  let time = 0;
  const calls = [];
  const client = new FeedbackClient({ userId: 'a', storage: new Storage(), sessionStorage: new Storage(), now: () => time, wall: () => Date.parse('2030-01-01') + time,
    transport: async (action, body, signal) => { calls.push({ action, body, signal }); return transport ? transport(action, body, signal) : status(); }, newId: randomUUID, ...options });
  client.start();
  const advance = milliseconds => { for (let end = time + milliseconds; time < end;) { time = Math.min(end, time + 5000); client.clock.advance(time, true); } };
  return { client, calls, advance, setTime: value => { time = value; } };
}
test('star defaults, integer ranges, optional text and UTF-16 boundaries match the shared API', () => {
  assert.equal(validDraft({ overall: null, recommendation: null, comment: '' }), false);
  assert.equal(validDraft({ ...draft, comment: '' }), true);
  assert.equal(validDraft({ ...draft, overall: '1' }), false);
  assert.equal(validDraft({ ...draft, recommendation: 6 }), false);
  assert.equal(validDraft({ ...draft, comment: '🙂'.repeat(1000) }), true);
  assert.equal(validDraft({ ...draft, comment: '🙂'.repeat(1000) + 'a' }), false);
  assert.equal(validDraft({ ...draft, comment: '\0' }), false);
});
test('foreground and idle boundaries exclude hidden time and large suspended gaps', () => {
  const clock = new FeedbackClock(); clock.advance(0, true);
  for (let time = 5000; time <= 115000; time += 5000) clock.advance(time, true);
  assert.equal(clock.ready(115000), false); clock.advance(120000, true); assert.equal(clock.ready(120000), true);
  clock.interact(119000); assert.equal(clock.ready(148999), false); assert.equal(clock.ready(149000), true);
  clock.advance(120001, false); assert.equal(clock.ready(999999), false);
  const suspended = new FeedbackClock(); suspended.advance(0, true); suspended.advance(900000, true);
  assert.equal(suspended.ready(900000), false);
});
test('unsafe surfaces defer offers and shown receipts are sent only after a dialog is presented', async () => {
  const invitationId = randomUUID(); const { client, calls, advance } = setup(action => status({ invitationId: action === 'invite' ? invitationId : null }));
  client.clock.advance(0, true); await client.tick({ active: () => true, safe: () => false });
  advance(120000); await client.tick({ active: () => true, safe: () => false });
  assert.deepEqual(calls.map(call => call.action), ['visit']); assert.equal(client.snapshot.open, false);
  advance(30000); await client.tick({ active: () => true, safe: () => true });
  assert.equal(client.snapshot.invitationId, invitationId); assert.equal(client.snapshot.open, true);
  assert.equal(calls.some(call => call.action === 'shown'), false);
  await client.shown(); assert.equal(calls.at(-1).action, 'shown');
});
test('surface changes during an invitation request cannot open over a new editor', async () => {
  let safe = true; const invitationId = randomUUID();
  const { client, advance } = setup(action => { if (action === 'invite') safe = false; return status({ invitationId: action === 'invite' ? invitationId : null }); });
  client.clock.advance(0, true); advance(120000);
  await client.tick({ active: () => true, safe: () => safe });
  assert.equal(client.snapshot.open, false);
});
test('offline opt-out persists per account, closes immediately and leaves voluntary feedback available', async () => {
  const storage = new Storage(); const { client } = setup(() => { throw new Error('offline'); }, { storage });
  await client.openManual(); await client.dismiss('never');
  assert.equal(client.snapshot.open, false); assert.equal(readPreference(storage, client.key).action, 'never');
  const reloaded = setup(null, { storage }).client;
  assert.equal(reloaded.preference.action, 'never'); await reloaded.openManual(); assert.equal(reloaded.snapshot.open, true);
  const other = setup(null, { storage, userId: 'b' }).client; assert.equal(other.preference, null);
});
test('pending choices retry with the same ID and never upload partial answers', async () => {
  let offline = true; const { client, calls } = setup(() => { if (offline) throw new Error('offline'); return status({ disabled: true }); });
  await client.openManual(); await client.dismiss('never'); const requestId = client.preference.requestId;
  offline = false; await client.syncPreference();
  assert.equal(client.preference.pending, false); assert.equal(calls.at(-1).body.requestId, requestId);
  assert.equal(calls.at(-1).body.overall, undefined); assert.equal(calls.at(-1).body.comment, undefined);
  assert.equal(calls.at(-1).body.platform, 'web');
});
test('later is durable across reloads and storage failures do not trap a dialog', async () => {
  const { client } = setup(() => { throw new Error('offline'); });
  await client.openManual(); await client.dismiss();
  assert.equal(client.preference.until, Date.parse('2030-01-01') + 14 * 86400000);
  const broken = setup(() => { throw new Error('offline'); }, { storage: { getItem: () => null, setItem: () => { throw new Error('blocked'); } } }).client;
  await broken.openManual(); await broken.dismiss('never'); assert.equal(broken.snapshot.open, false);
  assert.match(broken.snapshot.notice, /storage is unavailable/);
});
test('failed submissions retain the form, retries persist once and local storage contains no answers', async () => {
  let fail = true; const { client } = setup(action => {
    if (action === 'submit' && fail) throw new Error('temporary failure');
    return action === 'submit' ? status({ submitted: true, response }) : status();
  });
  await client.openManual(); await client.submit(draft); assert.equal(client.snapshot.open, true); assert.match(client.snapshot.error, /temporary/);
  fail = false; await client.submit(draft); assert.equal(client.snapshot.open, false); assert.equal(client.snapshot.status.response.overall, 1);
  const stored = client.storage.getItem(client.key); assert(!stored.includes('Needs work')); assert(!stored.includes('overall'));
});
test('late reads cannot overwrite a confirmed submission or reopen a closed form', async () => {
  let finish;
  const { client } = setup(action => action === null ? new Promise(resolve => { finish = resolve; }) : status({ submitted: true, response }));
  const pending = client.openManual(); await client.submit(draft); finish(status()); await pending;
  assert.equal(client.snapshot.status.submitted, true); assert.equal(client.snapshot.open, false);
});
test('unmount aborts old requests and ignores their results after a new account mounts', async () => {
  let finish;
  const { client, calls } = setup(() => new Promise(resolve => { finish = resolve; }));
  const pending = client.openManual(); client.stop(); assert.equal(calls[0].signal.aborted, true);
  finish(status({ submitted: true, response })); await pending;
  assert.equal(client.snapshot.status, null); assert.equal(client.snapshot.open, false);
});
test('unauthorized feedback clears state and invokes account-session recovery', async () => {
  let expired = false;
  const { client } = setup(() => { throw Object.assign(new Error('Expired'), { status: 401 }); }, { onUnauthorized: () => { expired = true; } });
  await client.openManual(); assert.equal(expired, true); assert.equal(client.snapshot.open, false); assert.equal(client.snapshot.status, null);
});
test('malformed stored choices and server results are rejected without exposing a fake rating', async () => {
  const storage = new Storage(); storage.setItem('a', JSON.stringify({ action: 'never', requestId: 'bad', pending: true }));
  assert.equal(readPreference(storage, 'a'), null);
  const { client } = setup(() => status({ response: { ...response, overall: 6 } }));
  await client.openManual(); assert.equal(client.snapshot.status, null); assert.match(client.snapshot.error, /Unable to read/);
});
