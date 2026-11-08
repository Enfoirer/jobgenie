import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import FeedbackProfile from '../lib/models/FeedbackProfile.js';
import ProductFeedback from '../lib/models/ProductFeedback.js';
import { feedbackAction, feedbackStatus, FEEDBACK_CAMPAIGN } from '../lib/feedback/feedback.js';
import { createFeedbackHandler } from '../lib/feedback/routeHandler.js';

const now = Date.parse('2030-04-01T10:00:00Z'), day = 86400000;
let replica, user, other;
const action = (data, clock = now, owner = user._id) => feedbackAction(owner, data, clock);
const preference = (type, extra = {}) => ({ action: type, requestId: randomUUID(), ...extra });
const submit = (fields = {}) => ({ action: 'submit', overall: 1, recommendation: 2, comment: 'Please improve offline support.', appVersion: '0.1.0', locale: 'en_US', ...fields });
async function experienced() {
  for (const offset of [-7, -2, 0]) await action({ action: 'visit' }, now + offset * day);
}
async function offer() { return (await action({ action: 'invite', requestId: randomUUID(), appVersion: '0.1.0', locale: 'en' })).invitationId; }
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User.init(), FeedbackProfile.init(), ProductFeedback.init()]);
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), FeedbackProfile.deleteMany({}), ProductFeedback.deleteMany({})]);
  user = await User.create({ email: 'feedback@example.test', password: 'not-a-login' });
  other = await User.create({ email: 'other-feedback@example.test', password: 'not-a-login' });
});

test('reading eligibility is owner-scoped and does not create a profile or exposure', async () => {
  assert.equal((await feedbackStatus(user._id, now)).eligible, false);
  assert.equal(await FeedbackProfile.countDocuments(), 0);
  await action(submit());
  const foreign = await feedbackStatus(other._id, now);
  assert.equal(foreign.submitted, false); assert.equal(foreign.response, null);
});
test('automatic eligibility needs seven elapsed days and three distinct recent UTC active days', async () => {
  await action({ action: 'visit' }, now - 7 * day);
  await action({ action: 'visit' }, now - 7 * day);
  await action({ action: 'visit' }, now - day);
  assert.equal((await feedbackStatus(user._id, now)).eligible, false);
  await action({ action: 'visit' });
  assert.equal((await feedbackStatus(user._id, now - 1)).eligible, false);
  assert.equal((await feedbackStatus(user._id, now)).eligible, true);
});
test('old activity ages out and daily visit retries do not inflate the sample', async () => {
  await experienced();
  for (let i = 0; i < 5; i++) await action({ action: 'visit' });
  assert.equal((await FeedbackProfile.findById(user._id)).activeDays.length, 3);
  assert.equal((await feedbackStatus(user._id, now + 31 * day)).eligible, false);
});
test('new accounts can voluntarily submit both low and high ratings without being invited', async () => {
  const low = await action(submit({ comment: 'Not useful yet.' }));
  assert.equal(low.response.overall, 1); assert.equal(low.response.source, 'manual');
  const high = await action(submit({ overall: 5, recommendation: 5, comment: '' }), now, other._id);
  assert.equal(high.response.overall, 5); assert.equal(high.response.comment, '');
});
test('no invitation is created for inexperienced users, and eligible offers are separated from shown receipts', async () => {
  await action({ action: 'visit' }, now - 7 * day);
  assert.equal((await action({ action: 'invite', requestId: randomUUID() }, now - 7 * day)).invitationId, null);
  await experienced();
  const id = await offer(); assert(id);
  let row = await FeedbackProfile.findById(user._id);
  assert.equal(row.invitations[0].disposition, 'offered'); assert.equal(row.invitations[0].shownAt, undefined);
  await action({ action: 'shown', invitationId: id });
  row = await FeedbackProfile.findById(user._id);
  assert.equal(row.invitations[0].shownAt.getTime(), now);
  assert.equal(row.invitations[0].disposition, 'shown');
});
test('concurrent invitation requests and same-request retries reserve only one slot', async () => {
  await experienced(); const requestId = randomUUID();
  const results = await Promise.all([action({ action: 'invite', requestId }), action({ action: 'invite', requestId })]);
  assert.equal(results[0].invitationId, results[1].invitationId);
  assert.equal((await FeedbackProfile.findById(user._id)).invitations.length, 1);
  assert.equal(await offer(), null);
});
test('later snoozes for fourteen days and repeated dismissal does not extend the snooze', async () => {
  await experienced(); const id = await offer(); const body = preference('later', { invitationId: id });
  const first = await action(body); await action(body, now + day);
  assert.equal((await feedbackStatus(user._id, now + day)).snoozedUntil, first.snoozedUntil);
  assert.equal((await feedbackStatus(user._id, now + 14 * day - 1)).eligible, false);
  assert.equal((await feedbackStatus(user._id, now + 14 * day)).eligible, true);
});
test('manual offline-choice retry is idempotent and later never clears a permanent opt-out', async () => {
  const body = preference('later'); await action(body); await action(body, now + day);
  assert.equal((await FeedbackProfile.findById(user._id)).manualLaterCount, 1);
  await action(preference('never'));
  await action(preference('later'), now + 50 * day);
  assert.equal((await feedbackStatus(user._id, now + 50 * day)).disabled, true);
});
test('never persists across fresh reads and blocks all automatic invites but allows manual feedback', async () => {
  await experienced(); const id = await offer();
  await action(preference('never', { invitationId: id }));
  assert.equal((await feedbackStatus(user._id, now + 100 * day)).disabled, true);
  assert.equal(await offer(), null);
  const saved = await action(submit()); assert.equal(saved.submitted, true); assert.equal(saved.disabled, true);
});
test('at most two automatic offers are made even without a response', async () => {
  await experienced(); await offer();
  const second = await action({ action: 'invite', requestId: randomUUID() }, now + 14 * day);
  assert(second.invitationId);
  await action({ action: 'visit' }, now + 28 * day);
  assert.equal((await action({ action: 'invite', requestId: randomUUID() }, now + 28 * day)).invitationId, null);
  assert.equal((await FeedbackProfile.findById(user._id)).invitations.length, 2);
});
test('prompt submission retains sampling context and requires a real owned display receipt', async () => {
  await experienced(); const id = await offer();
  await assert.rejects(action(submit({ invitationId: id })), error => error.status === 409);
  await assert.rejects(action({ action: 'shown', invitationId: id }, now, other._id), error => error.status === 404);
  await action({ action: 'shown', invitationId: id });
  await action(submit({ invitationId: id, overall: 2, recommendation: 1, comment: '  Needs work.  ' }));
  const saved = await ProductFeedback.findOne({ userId: user._id });
  assert.equal(saved.source, 'prompt'); assert.equal(saved.invitationId, id); assert.equal(saved.comment, 'Needs work.');
  assert.equal(saved.activeDayCount, 3); assert.equal(saved.daysSinceFirstSeen, 7);
  assert.equal(saved.locale, 'en_US'); assert.equal(saved.campaign, FEEDBACK_CAMPAIGN);
  assert.equal((await FeedbackProfile.findById(user._id)).invitations[0].disposition, 'submitted');
});
test('concurrent submissions and changed-payload retries cannot duplicate or overwrite feedback', async () => {
  const results = await Promise.all([action(submit()), action(submit())]);
  assert(results.every(result => result.submitted)); assert.equal(await ProductFeedback.countDocuments(), 1);
  const retry = await action(submit({ overall: 5, comment: 'Different retry' }));
  assert.equal(retry.response.overall, 1); assert.equal(retry.response.comment, 'Please improve offline support.');
  await action(preference('later')); assert.equal((await feedbackStatus(user._id, now)).submitted, true);
});
test('strict score, text, context, action and protected-field validation prevents malformed analysis data', async () => {
  for (const fields of [{ overall: 0 }, { overall: 6 }, { recommendation: 2.5 }, { overall: '5' }, { overall: true }, { recommendation: null }, { comment: 'a'.repeat(2001) }, { comment: '\0' }, { userId: other._id }, { source: 'prompt' }, { createdAt: new Date().toISOString() }, { locale: 'en<script>' }]) {
    await assert.rejects(action(submit(fields)), error => error.status === 400);
  }
  for (const body of [null, [], { action: 'bad' }, { action: '__proto__' }, { action: 'invite', requestId: 'bad' }, { action: 'shown' }, { action: 'never' }]) await assert.rejects(action(body), error => error.status === 400);
  assert.equal(await ProductFeedback.countDocuments(), 0);
});
test('a late shown acknowledgment retains a dismissal rather than reopening it', async () => {
  await experienced(); const id = await offer(); await action(preference('never', { invitationId: id }));
  await action({ action: 'shown', invitationId: id }, now + 1);
  const row = await FeedbackProfile.findById(user._id);
  assert.equal(row.invitations[0].disposition, 'never'); assert.equal(row.invitations[0].shownAt.getTime(), now);
});
test('API authenticates first, enforces origin, bounds streaming JSON and hides private failures', async () => {
  let connects = 0;
  const handler = owner => createFeedbackHandler({ authenticate: async () => owner, connect: async () => { connects++; } });
  const request = body => new Request('https://example.test/api/feedback', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await handler(null)(request(submit()))).status, 401); assert.equal(connects, 0);
  const cross = request(submit()); cross.headers.set('origin', 'https://foreign.test');
  assert.equal((await handler(String(user._id))(cross)).status, 403); assert.equal(connects, 0);
  assert.equal((await handler(String(user._id))(request({ action: 'visit', padding: 'x'.repeat(13000) }))).status, 413);
  const bad = new Request('https://example.test/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal((await handler(String(user._id))(bad)).status, 400);
  const response = await handler(String(user._id))(request(submit())); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const data = await response.json(); assert.equal(data.response.overall, 1); assert.equal(data.userId, undefined);
});
test('API rate limits per account and returns no comments or internals on service failure', async () => {
  const limited = createFeedbackHandler({ authenticate: async () => String(user._id), connect: async () => {}, limit: async () => false });
  const request = () => new Request('https://example.test/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submit()) });
  const response = await limited(request()); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
  const failed = createFeedbackHandler({ authenticate: async () => String(user._id), connect: async () => { throw new Error('private database contents'); } });
  const result = await failed(request()); assert.equal(result.status, 503); assert(!JSON.stringify(await result.json()).includes('private database'));
});
test('web and legacy iOS visits share eligibility while retaining platform on offers and responses', async () => {
  await action({ action: 'visit', platform: 'web' }, now - 7 * day);
  await action({ action: 'visit' }, now - day);
  assert.equal((await action({ action: 'visit', platform: 'web' })).eligible, true);
  const offered = await action({ action: 'invite', requestId: randomUUID(), platform: 'web' });
  await action({ action: 'shown', invitationId: offered.invitationId, platform: 'web' });
  const response = await action(submit({ platform: 'web', invitationId: offered.invitationId }));
  assert.equal(response.response.platform, 'web');
  assert.equal((await FeedbackProfile.findById(user._id)).invitations[0].platform, 'web');
  const nativeRead = await feedbackStatus(user._id, now);
  assert.equal(nativeRead.campaign, 'ios-product-v1'); assert.equal(nativeRead.submitted, true);
  assert.equal((await action(submit({ overall: 5 }))).response.overall, 1);
  assert.equal(await ProductFeedback.countDocuments({ userId: user._id }), 1);
});
test('web cannot overwrite an existing legacy iOS answer and old rows retain their platform default', async () => {
  await action(submit());
  await ProductFeedback.collection.updateOne({ userId: user._id }, { $unset: { platform: '' } });
  const response = await action(submit({ platform: 'web', overall: 5, comment: 'Changed' }));
  assert.equal(response.response.overall, 1); assert.equal(response.response.platform, 'ios');
  assert.equal(response.response.comment, 'Please improve offline support.');
  await assert.rejects(action({ action: 'visit', platform: 'unknown' }), error => error.status === 400);
});
test('simultaneous web and iOS submissions retain exactly one unchanged account response', async () => {
  const values = await Promise.all([action(submit({ platform: 'web', overall: 3 })), action(submit({ overall: 1 }))]);
  assert.equal(await ProductFeedback.countDocuments(), 1);
  assert.deepEqual(values[0].response, values[1].response);
  assert(['web', 'ios'].includes(values[0].response.platform));
});
test('cross-platform manual later invalidates an unshown reserved offer without claiming an exposure', async () => {
  await experienced(); const requestId = randomUUID();
  const offered = await action({ action: 'invite', requestId, platform: 'web' }); assert(offered.invitationId);
  await action(preference('later'), now + 1000); // A manual choice from the legacy iOS client.
  assert.equal((await action({ action: 'invite', requestId, platform: 'web' }, now + 2000)).invitationId, null);
  const row = await FeedbackProfile.findById(user._id);
  assert.equal(row.invitations[0].disposition, 'later'); assert.equal(row.invitations[0].shownAt, undefined);
  await action(preference('never', { platform: 'web' }));
  assert.equal((await feedbackStatus(user._id, now)).disabled, true);
});
