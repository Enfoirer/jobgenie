import { readFileSync } from 'node:fs';
import { processEmailForPending } from '../lib/pipeline/emailProcessor.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import MailAccount from '../lib/models/MailAccount.js';
import ProcessedEmail from '../lib/models/ProcessedEmail.js';
import PendingItem from '../lib/models/PendingItem.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import { syncMailAccounts } from '../lib/pipeline/mailSync.js';
import { reviewPendingItem } from '../lib/pipeline/pendingReview.js';
import { emailEventKey } from '../lib/pipeline/jobUpdater.js';

let replica;
let user;
let account;
const models = [User, MailAccount, ProcessedEmail, PendingItem, Job, StatusHistory];
const parsed = { shouldCreate: true, parsed: { eventType: 'interview', company: 'Acme', position: 'Engineer', confidence: 0.95 } };
const message = (id = 'mail-1') => ({
  id, provider: 'gmail', subject: 'Interview invitation', snippet: 'Please select a time.',
  bodyText: 'Please select a time.', from: 'recruiter@example.test',
  historyId: '9007199254740993', receivedAt: '2026-10-17T01:00:00Z',
});
const options = (messages = [message()], overrides = {}) => ({
  fetchers: {
    gmail: async () => ({ messages, cursor: { historyId: '9007199254740993', gmailSync: null } }),
    outlook: async () => ({ messages, cursor: { outlookSync: null, ...(messages.length ? { lastReceivedAt: new Date(messages[0].receivedAt) } : {}) } }),
  },
  parseEmail: async (mail) => ({ ...structuredClone(parsed), parsed: { ...parsed.parsed, company: mail.id === 'mail-1' ? 'Acme' : mail.id === 'mail-2' ? 'Zebra Industries' : `Company ${mail.id}` } }),
  ...overrides,
});
const sync = (opts = options(), accounts = [account]) => syncMailAccounts(accounts, opts);
const stored = () => ProcessedEmail.findOne({ accountId: account._id, messageId: 'mail-1' }).lean();

before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri());
  await Promise.all(models.map((model) => model.init()));
});
after(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
  user = await User.create({ email: 'user@example.test', password: 'test-only', syncMode: 'auto' });
  account = await MailAccount.create({
    provider: 'gmail', emailAddress: user.email, accessToken: 'test-only',
    userId: user._id, metadata: { historyId: '100' },
  });
});

test('stores the full batch before advancing the cursor or parsing', async () => {
  const result = await sync(options([message(), message('mail-2')], {
    parseEmail: async () => {
      assert.equal(await ProcessedEmail.countDocuments(), 2);
      assert.equal((await MailAccount.findById(account._id)).metadata.historyId, '9007199254740993');
      return { shouldCreate: false };
    },
  }));
  assert.equal(result.processed, 2);
  assert.equal(result.errors.length, 0);
  assert.equal((await stored()).raw.bodyText, message().bodyText);
});

test('failed second inbox write keeps the old cursor; next sync recovers the remainder', async (t) => {
  const original = ProcessedEmail.updateOne.bind(ProcessedEmail);
  const patch = t.mock.method(ProcessedEmail, 'updateOne', (filter, ...args) => {
    if (filter.messageId === 'mail-2') throw new Error('inbox unavailable');
    return original(filter, ...args);
  });
  let result = await sync(options([message(), message('mail-2')]));
  assert.equal((await MailAccount.findById(account._id)).metadata.historyId, '100');
  assert.equal(await ProcessedEmail.countDocuments(), 1);
  assert.equal(result.errors[0].stage, 'ingest');
  patch.mock.restore();
  result = await sync(options([message(), message('mail-2')]));
  assert.equal(result.errors.length, 0);
  assert.equal(await ProcessedEmail.countDocuments({ status: 'succeeded' }), 2);
  assert.equal(await Job.countDocuments(), 2);
  assert.equal(await StatusHistory.countDocuments(), 2);
});

test('cursor save failure still leaves a durable inbox and a safe replay', async (t) => {
  const patch = t.mock.method(account, 'save', async () => { throw new Error('cursor unavailable'); });
  const result = await sync();
  assert.equal(result.errors[0].stage, 'ingest');
  assert.equal((await stored()).status, 'succeeded');
  assert.equal((await MailAccount.findById(account._id)).metadata.historyId, '100');
  patch.mock.restore();
  await sync();
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 1);
});

test('parser failure is recorded and retried even if the mailbox is unavailable', async () => {
  let result = await sync(options([message()], { parseEmail: async () => { throw new Error('parser offline'); } }));
  assert.equal(result.failed, 1);
  assert.equal((await stored()).status, 'failed');
  assert.equal((await stored()).lastError, 'parser offline');
  assert.equal(await Job.countDocuments(), 0);
  result = await sync(options([], { fetchers: { gmail: async () => { throw new Error('mail offline'); } } }));
  const email = await stored();
  assert.equal(result.retried, 1);
  assert.equal(email.status, 'succeeded');
  assert.equal(email.attempts, 2);
  assert.equal(email.lastError, undefined);
  assert.equal(await Job.countDocuments(), 1);
});

test('one failing email does not prevent the rest of the batch from processing', async () => {
  const result = await sync(options([message(), message('mail-2')], {
    parseEmail: async (mail) => {
      if (mail.id === 'mail-1') throw new Error('bad mail');
      return structuredClone(parsed);
    },
  }));
  assert.equal(result.failed, 1);
  assert.equal(result.processed, 1);
  assert.equal(await ProcessedEmail.countDocuments({ status: 'failed' }), 1);
});

test('history write failure rolls back the newly created job and success marker', async (t) => {
  const patch = t.mock.method(StatusHistory, 'create', async () => { throw new Error('history unavailable'); });
  await sync();
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(await StatusHistory.countDocuments(), 0);
  assert.equal((await stored()).status, 'failed');
  patch.mock.restore();
  await sync(options([]));
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 1);
  assert.equal((await stored()).status, 'succeeded');
});

test('history failure also rolls back changes to an existing application', async (t) => {
  const job = await Job.create({ userId: user._id, company: 'Acme', position: 'Engineer', status: 'applied', notes: 'original' });
  t.mock.method(StatusHistory, 'create', async () => { throw new Error('history unavailable'); });
  await sync(options([message()], { parseEmail: async () => ({
    shouldCreate: true, parsed: { ...parsed.parsed, company: 'Acme', position: 'Engineer' },
  }) }));
  const unchanged = await Job.findById(job._id);
  assert.equal(unchanged.status, 'applied');
  assert.equal(unchanged.notes, 'original');
  assert.equal((await stored()).status, 'failed');
});

test('failure saving the final success marker rolls back all business writes', async (t) => {
  const original = ProcessedEmail.prototype.save;
  const patch = t.mock.method(ProcessedEmail.prototype, 'save', async function (...args) {
    if (this.status === 'succeeded') throw new Error('completion unavailable');
    return original.apply(this, args);
  });
  await sync();
  assert.equal(await Job.countDocuments(), 0);
  assert.equal(await StatusHistory.countDocuments(), 0);
  assert.equal((await stored()).status, 'failed');
  patch.mock.restore();
  await sync(options([]));
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 1);
});

test('repeated sync creates one job and one history for fully extracted application fields', async () => {
  await sync();
  const result = await sync();
  assert.equal(result.skipped, 1);
  assert.equal(result.processed, 0);
  assert.equal((await stored()).attempts, 1);
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 1);
});

test('concurrent manual/cron syncs claim an email once', async () => {
  const accounts = await Promise.all([MailAccount.findById(account._id), MailAccount.findById(account._id)]);
  const results = await Promise.all(accounts.map((mailAccount) => sync(options(), [mailAccount])));
  assert.equal(results.flatMap((r) => r.errors).length, 0);
  assert.equal(results.reduce((sum, r) => sum + r.processed, 0), 1);
  assert.equal(await ProcessedEmail.countDocuments(), 1);
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 1);
});

test('expired processing locks recover after a worker crash', async () => {
  await ProcessedEmail.create({
    accountId: account._id, userId: user._id, provider: 'gmail', messageId: 'mail-1',
    raw: message(), status: 'processing', leaseToken: 'dead-worker', leaseUntil: new Date(0), attempts: 1,
  });
  const result = await sync(options([]));
  assert.equal(result.retried, 1);
  assert.equal((await stored()).status, 'succeeded');
  assert.equal((await stored()).leaseToken, undefined);
});

test('a live processing lock is not stolen', async () => {
  await ProcessedEmail.create({
    accountId: account._id, userId: user._id, provider: 'gmail', messageId: 'mail-1',
    raw: message(), status: 'processing', leaseToken: 'live-worker',
    leaseUntil: new Date(Date.now() + 60_000), attempts: 1,
  });
  await sync(options([]));
  assert.equal((await stored()).attempts, 1);
  assert.equal(await Job.countDocuments(), 0);
});

test('a stale worker cannot commit after another worker reclaimed its lease', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const first = sync(options([message()], { parseEmail: async () => {
    entered();
    await blocked;
    return { shouldCreate: true, parsed: { ...parsed.parsed, eventType: 'rejection' } };
  } }));
  await started;
  try {
    await ProcessedEmail.updateOne({ messageId: 'mail-1' }, { $set: { leaseUntil: new Date(0) } });
    await sync(options([]), [await MailAccount.findById(account._id)]);
  } finally {
    release();
  }
  await first;
  assert.equal((await stored()).status, 'succeeded');
  assert.equal((await Job.findOne()).status, 'interviewing');
  assert.equal(await StatusHistory.countDocuments(), 1);
});

test('pending review insertion failure remains retryable', async (t) => {
  user.syncMode = 'semi';
  await user.save();
  const patch = t.mock.method(PendingItem, 'updateOne', async () => { throw new Error('review unavailable'); });
  await sync();
  assert.equal((await stored()).status, 'failed');
  assert.equal(await PendingItem.countDocuments(), 0);
  patch.mock.restore();
  await sync(options([]));
  await sync();
  assert.equal((await stored()).status, 'succeeded');
  assert.equal(await PendingItem.countDocuments(), 1);
  assert.equal(await Job.countDocuments(), 0);
});

test('accepting the same pending item concurrently is idempotent', async () => {
  user.syncMode = 'semi';
  await user.save();
  await sync();
  const item = await PendingItem.findOne();
  const results = await Promise.all([1, 2].map(() => reviewPendingItem({
    id: item._id, userId: user._id, action: 'accept',
  })));
  assert.equal(String(results[0].jobId), String(results[1].jobId));
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 1);
  await sync();
  assert.equal(await PendingItem.countDocuments(), 1);
  assert.equal(await Job.countDocuments(), 1);
});

test('failed acceptance rolls back both review status and job; retry succeeds', async (t) => {
  user.syncMode = 'semi';
  await user.save();
  await sync();
  const item = await PendingItem.findOne();
  const request = { id: item._id, userId: user._id, action: 'accept' };
  const patch = t.mock.method(StatusHistory, 'create', async () => { throw new Error('history unavailable'); });
  await assert.rejects(reviewPendingItem(request), /history unavailable/);
  assert.equal((await PendingItem.findById(item._id)).status, 'pending');
  assert.equal(await Job.countDocuments(), 0);
  patch.mock.restore();
  await reviewPendingItem(request);
  assert.equal((await PendingItem.findById(item._id)).status, 'accepted');
  assert.equal(await Job.countDocuments(), 1);
});

test('different mailboxes may safely contain the same provider message ID', async () => {
  user.syncMode = 'semi';
  await user.save();
  const second = await MailAccount.create({
    provider: 'gmail', emailAddress: 'second@example.test', accessToken: 'test-only', userId: user._id,
  });
  await sync(options(), [account, second]);
  assert.equal(await ProcessedEmail.countDocuments(), 2);
  assert.equal(await PendingItem.countDocuments(), 2);
});

test('legacy processed rows are not blindly replayed', async () => {
  await ProcessedEmail.collection.insertOne({
    accountId: account._id, userId: user._id, provider: 'gmail', messageId: 'mail-1',
  });
  const result = await sync();
  assert.equal(result.skipped, 1);
  assert.equal(result.processed, 0);
  assert.equal(await Job.countDocuments(), 0);
});

test('unrelated emails finish successfully without business records', async () => {
  await sync(options([message()], { parseEmail: async () => ({ shouldCreate: false, reason: 'non_status_update' }) }));
  assert.equal((await stored()).status, 'succeeded');
  assert.equal((await stored()).outcome, 'skipped');
  assert.equal(await PendingItem.countDocuments(), 0);
  assert.equal(await Job.countDocuments(), 0);
});

test('source event index prevents duplicate history but allows manual history', async () => {
  const job = await Job.create({ userId: user._id, company: 'Acme', position: 'Engineer' });
  const history = { userId: user._id, jobId: job._id, status: 'applied' };
  const key = emailEventKey(account._id, 'mail-1');
  await StatusHistory.create({ ...history, sourceEmailKey: key });
  await assert.rejects(StatusHistory.create({ ...history, sourceEmailKey: key }), { code: 11000 });
  await StatusHistory.create([history, history]);
  assert.equal(await StatusHistory.countDocuments(), 3);
});

test('Outlook also stores before advancing its received-at cursor', async () => {
  account.provider = 'outlook';
  await account.save();
  await sync(options([{ ...message(), provider: 'outlook' }], {
    parseEmail: async () => {
      assert.equal(await ProcessedEmail.countDocuments(), 1);
      assert.equal((await MailAccount.findById(account._id)).metadata.lastReceivedAt.toISOString(), message().receivedAt.replace('Z', '.000Z'));
      return { shouldCreate: false };
    },
  }));
  assert.equal((await stored()).status, 'succeeded');
});

test('malformed fetched mail cannot advance the cursor', async () => {
  const result = await sync(options([{ ...message(), id: undefined }]));
  assert.equal(result.errors[0].stage, 'ingest');
  assert.equal(await ProcessedEmail.countDocuments(), 0);
  assert.equal((await MailAccount.findById(account._id)).metadata.historyId, '100');
});

test('replaying a previously applied source event does not repeat its effects', async () => {
  await sync();
  await ProcessedEmail.updateOne({ messageId: 'mail-1' }, { $set: { status: 'failed' } });
  await sync(options([]));
  assert.equal((await stored()).status, 'succeeded');
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 1);
});

test('durable pending work drains on the next sync without refetching the mail', async () => {
  await sync(options([message(), message('mail-2')], { retryLimit: 1 }));
  assert.equal(await ProcessedEmail.countDocuments({ status: 'pending' }), 1);
  const result = await sync(options([]));
  assert.equal(result.totalFetched, 0);
  assert.equal(result.processed, 1);
  assert.equal(await ProcessedEmail.countDocuments({ status: 'succeeded' }), 2);
});

test('index rollout is repeatable, preserves data and replaces only the legacy constraint', async () => {
  user.syncMode = 'semi';
  await user.save();
  await sync();
  await PendingItem.collection.createIndex({ userId: 1, messageId: 1, provider: 1 }, { unique: true });
  await PendingItem.collection.createIndex({ subject: 1 }, { name: 'unrelated_test_index' });
  const script = fileURLToPath(new URL('../scripts/ensure-mail-indexes.mjs', import.meta.url));
  const run = () => promisify(execFile)(process.execPath, [script], {
    env: { ...process.env, MONGODB_URI: replica.getUri() },
  });
  await run();
  await run();
  const indexes = await PendingItem.collection.indexes();
  assert.ok(indexes.some((i) => i.name === 'accountId_1_messageId_1' && i.unique));
  assert.ok(indexes.some((i) => i.name === 'unrelated_test_index'));
  assert.ok(!indexes.some((i) => i.name === 'userId_1_messageId_1_provider_1'));
  assert.equal(await PendingItem.countDocuments(), 1);
  assert.equal((await stored()).status, 'succeeded');
});

test('real Gmail pagination persists unconsumed IDs and drains mail beyond the per-sync limit', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/history')) {
      return Response.json({
        history: [{ messagesAdded: Array.from({ length: 7 }, (_,i) => ({ message: { id: `gmail-${i}` } })) }],
        historyId: '300',
      });
    }
    return Response.json({ id: url.pathname.split('/').at(-1), historyId: '99999', internalDate: '1792198800000' });
  });
  for (let round = 0; round < 4; round++) {
    const current = await MailAccount.findById(account._id);
    const result = await sync({ limit: 2, parseEmail: async () => ({ shouldCreate: false }) }, [current]);
    assert.equal(result.errors.length, 0);
    assert.ok(result.totalFetched <= 2);
    assert.equal(result.hasMore, round < 3);
    assert.equal(await ProcessedEmail.countDocuments(), Math.min((round + 1) * 2, 7));
    const saved = await MailAccount.findById(account._id);
    assert.equal(saved.metadata.historyId, round < 3 ? '100' : '300');
  }
  assert.equal(await ProcessedEmail.countDocuments({ status: 'succeeded' }), 7);
});

test('an inbox failure does not consume a persisted Gmail continuation', async (t) => {
  account.metadata.gmailSync = {
    mode: 'history', startHistoryId: '100', remainingIds: ['a', 'b'],
    loaded: true, pageToken: null, completionHistoryId: '300',
  };
  await account.save();
  t.mock.method(globalThis, 'fetch', async (input) => Response.json({
    id: new URL(input).pathname.split('/').at(-1), internalDate: '1792198800000',
  }));
  const original = ProcessedEmail.updateOne.bind(ProcessedEmail);
  const patch = t.mock.method(ProcessedEmail, 'updateOne', (filter, ...args) => {
    if (filter.messageId === 'b') throw new Error('inbox unavailable');
    return original(filter, ...args);
  });
  let result = await sync({ limit: 2, parseEmail: async () => ({ shouldCreate: false }) });
  assert.equal(result.hasMore, true);
  let saved = await MailAccount.findById(account._id);
  assert.deepEqual(saved.metadata.gmailSync.remainingIds, ['a', 'b']);
  assert.equal(saved.metadata.historyId, '100');
  patch.mock.restore();
  result = await sync({ limit: 2, parseEmail: async () => ({ shouldCreate: false }) }, [saved]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.skipped, 1);
  saved = await MailAccount.findById(account._id);
  assert.equal(saved.metadata.gmailSync, null);
  assert.equal(saved.metadata.historyId, '300');
  assert.equal(await ProcessedEmail.countDocuments(), 2);
});

test('real Outlook paging persists nextLink and overflow before completing its watermark', async (t) => {
  account.provider = 'outlook';
  account.metadata.lastReceivedAt = new Date('2026-10-16T00:00:00Z');
  await account.save();
  const link = 'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$skiptoken=next';
  const item = (id) => ({ id, receivedDateTime: '2026-10-17T01:00:00Z' });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    requests++;
    return Response.json(String(input) === link
      ? { value: [item('c'), item('d')] }
      : { value: [item('a'), item('b')], '@odata.nextLink': link });
  });
  for (const [limit, expected, more] of [[2, 2, true], [1, 3, true], [1, 4, false]]) {
    const result = await sync({ limit, parseEmail: async () => ({ shouldCreate: false }) }, [await MailAccount.findById(account._id)]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.hasMore, more);
    assert.equal(await ProcessedEmail.countDocuments(), expected);
    const saved = await MailAccount.findById(account._id);
    assert.equal(saved.metadata.lastReceivedAt.toISOString(), more ? '2026-10-16T00:00:00.000Z' : '2026-10-17T01:00:00.000Z');
  }
  assert.equal(requests, 2);
});

test('sync summaries distinguish fetched, duplicate, applied, review, irrelevant and failed mail', async () => {
  const messages = ['apply', 'review', 'irrelevant', 'fail', 'apply'].map(message);
  const result = await sync(options(messages, {
    fetchers: { gmail: async () => ({ messages, pagesFetched: 2, unavailable: 1, cursorResets: 1, cursor: { historyId: '300', gmailSync: null } }) },
    parseEmail: async (mail) => {
      if (mail.id === 'fail') throw new Error('parse failure');
      if (mail.id === 'irrelevant') return { shouldCreate: false };
      return { shouldCreate: true, parsed: { company: `Company ${mail.id}`, position: 'Engineer', eventType: 'submission', confidence: mail.id === 'review' ? 0.2 : 0.9 } };
    },
  }));
  assert.equal(result.totalFetched, 5);
  assert.equal(result.stored, 4);
  assert.equal(result.skipped, 1);
  assert.equal(result.processed, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.applied, 1);
  assert.equal(result.pendingReview, 1);
  assert.equal(result.irrelevant, 1);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.unavailable, 1);
  assert.equal(result.cursorResets, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.hasPendingWork, true);
  assert.deepEqual(result.accounts[0].backlog, { pending: 0, processing: 0, failed: 1, pendingReview: 1 });
  const retry = await sync(options([]));
  assert.equal(retry.totalFetched, 0);
  assert.equal(retry.retried, 1);
  assert.equal(retry.processed, 1);
  assert.equal(retry.applied, 1);
  assert.equal(retry.hasPendingWork, false);
  assert.equal(retry.accounts[0].backlog.pendingReview, 1);
});

test('aggregate summaries add independent mailboxes without losing per-account errors', async () => {
  const second = await MailAccount.create({
    provider: 'outlook', emailAddress: 'outlook@example.test', accessToken: 'test-only', userId: user._id,
  });
  const result = await sync(options([message()], {
    fetchers: {
      gmail: async () => ({ messages: [message()], cursor: { historyId: '300' } }),
      outlook: async () => { throw new Error('outlook offline'); },
    },
  }), [account, second]);
  assert.equal(result.accounts.length, 2);
  assert.equal(result.totalFetched, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(result.accounts[0].errorCount, 0);
  assert.equal(result.accounts[1].errorCount, 1);
  assert.equal(result.errors[0].accountId, String(second._id));
});

test('empty account results return the same complete zero summary', async () => {
  const result = await sync(options(), []);
  assert.deepEqual(result.accounts, []);
  assert.equal(result.totalFetched, 0);
  assert.equal(result.pendingReview, 0);
  assert.equal(result.errorCount, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.hasPendingWork, false);
});

test('failed backlog reads report unknown status instead of claiming the queue is empty', async (t) => {
  t.mock.method(ProcessedEmail, 'aggregate', async () => { throw new Error('summary unavailable'); });
  const result = await sync();
  assert.equal(result.processed, 1);
  assert.equal(result.hasMore, null);
  assert.equal(result.hasPendingWork, null);
  assert.equal(result.accounts[0].backlog, null);
  assert.equal(result.errors[0].stage, 'summary');
  assert.equal(result.errorCount, 1);
});

const acceptanceEmails = JSON.parse(readFileSync(new URL('./fixtures/application-emails.json', import.meta.url)));
const seedApplication = (overrides = {}) => Job.create({
  userId: user._id, company: 'ACME, Inc.', position: 'Backend SWE', status: 'applied',
  dateApplied: new Date('2026-10-01T00:00:00Z'), lastStatusEventAt: new Date('2026-10-01T00:00:00Z'), notes: 'My application notes',
  ...overrides,
});
const fixtureSync = (fixture, overrides = {}, accounts = [account]) => sync(options([fixture.message], {
  parseEmail: (mail) => processEmailForPending(mail, { extractor: async () => fixture.extraction }),
  ...overrides,
}), accounts);

for (const fixture of acceptanceEmails) {
  test(`database acceptance for fixed ${fixture.name} email`, async () => {
    const original = await seedApplication();
    const result = await fixtureSync(fixture);
    assert.equal(result.failed, 0);
    assert.equal(result.errors.length, 0);
    if (fixture.name === 'marketing') {
      assert.equal(result.irrelevant, 1);
      assert.equal(await PendingItem.countDocuments(), 0);
      assert.equal(await StatusHistory.countDocuments(), 0);
    } else if (fixture.name === 'incomplete') {
      assert.equal(result.pendingReview, 1);
      assert.equal(await StatusHistory.countDocuments(), 0);
      assert.equal(await Job.countDocuments({ company: 'Unknown Company' }), 0);
      const item = await PendingItem.findOne();
      await assert.rejects(reviewPendingItem({ id: item._id, userId: user._id, action: 'accept' }), /Company and position/);
      await reviewPendingItem({ id: item._id, userId: user._id, action: 'accept', updates: { targetJobId: String(original._id) } });
      assert.equal(await Job.countDocuments(), 1);
    } else {
      const expected = { submission: 'applied', oa: 'interviewing', interview: 'interviewing', rejection: 'rejected', offer: 'offer' }[fixture.expectedEvent];
      assert.equal(result.applied, 1);
      const job = await Job.findById(original._id);
      assert.equal(job.status, expected);
      assert.equal(job.notes, 'My application notes');
      const history = await StatusHistory.findOne();
      assert.equal(history.source.messageId, fixture.message.id);
      assert.equal(history.source.provider, 'gmail');
      assert.equal(history.source.from, fixture.message.from);
      assert.equal(history.source.receivedAt.toISOString(), fixture.message.receivedAt.replace('Z', '.000Z'));
      assert.equal(history.date.toISOString(), history.source.receivedAt.toISOString());
      if (fixture.name === 'interview') assert.equal(history.scheduledTime.toISOString(), '2026-10-21T13:00:00.000Z');
      if (fixture.name === 'assessment') assert.equal(history.deadline.toISOString(), '2026-10-21T03:59:00.000Z');
    }
    assert.equal(await Job.countDocuments(), 1);
  });
}

test('Semi automatically updates a matched interview but reviews offers, rejections and new applications', async () => {
  user.syncMode = 'semi'; await user.save();
  const original = await seedApplication();
  const interview = acceptanceEmails.find((f) => f.name === 'interview');
  assert.equal((await fixtureSync(interview)).applied, 1);
  for (const name of ['offer', 'rejection']) assert.equal((await fixtureSync(acceptanceEmails.find((f) => f.name === name))).pendingReview, 1);
  assert.equal((await Job.findById(original._id)).status, 'interviewing');
  const newMail = { ...message('new-application'), subject: 'Application received', bodyText: 'Company: Zebra\nPosition: Analyst\nThank you for applying.' };
  const result = await sync(options([newMail], { parseEmail: (mail) => processEmailForPending(mail, { extractor: async () => undefined }) }));
  assert.equal(result.pendingReview, 1);
  assert.equal(await Job.countDocuments(), 1);
});

test('Strict queues every relevant fixture and does not update the matched application', async () => {
  user.syncMode = 'strict'; await user.save();
  const original = await seedApplication();
  for (const fixture of acceptanceEmails.filter((f) => f.expectedCreate)) assert.equal((await fixtureSync(fixture)).pendingReview, 1);
  assert.equal(await PendingItem.countDocuments(), 6);
  assert.equal(await StatusHistory.countDocuments(), 0);
  assert.equal((await Job.findById(original._id)).status, 'applied');
});

test('ambiguous application matches require an explicit owned target before acceptance', async () => {
  const first = await seedApplication();
  const second = await seedApplication();
  const result = await fixtureSync(acceptanceEmails.find((f) => f.name === 'interview'));
  assert.equal(result.pendingReview, 1);
  const item = await PendingItem.findOne();
  assert.equal(item.matchStatus, 'ambiguous');
  assert.equal(item.candidates.length, 2);
  await assert.rejects(reviewPendingItem({ id: item._id, userId: user._id, action: 'accept' }), { status: 409 });
  await reviewPendingItem({ id: item._id, userId: user._id, action: 'accept', updates: { targetJobId: String(second._id) } });
  assert.equal((await Job.findById(first._id)).status, 'applied');
  assert.equal((await Job.findById(second._id)).status, 'interviewing');
  assert.equal(await StatusHistory.countDocuments(), 1);
});

test('review cannot link an email to another user application', async () => {
  user.syncMode = 'strict'; await user.save();
  await fixtureSync(acceptanceEmails[0]);
  const item = await PendingItem.findOne();
  const other = await User.create({ email: 'other@example.test', password: 'test-only' });
  const foreign = await seedApplication({ userId: other._id });
  await assert.rejects(reviewPendingItem({ id: item._id, userId: user._id, action: 'accept', updates: { targetJobId: String(foreign._id) } }), { status: 403 });
  assert.equal((await PendingItem.findById(item._id)).status, 'pending');
  assert.equal(await StatusHistory.countDocuments(), 0);
});

test('old interview mail records its source and scheduled date without replacing a newer offer', async () => {
  const original = await seedApplication({ status: 'offer', lastStatusEventAt: new Date('2026-10-17T03:00:00Z') });
  const fixture = structuredClone(acceptanceEmails.find((f) => f.name === 'interview'));
  fixture.message.receivedAt = '2026-10-16T01:00:00Z';
  const result = await fixtureSync(fixture);
  assert.equal(result.historical, 1);
  assert.equal(result.applied, 0);
  assert.equal((await Job.findById(original._id)).status, 'offer');
  const history = await StatusHistory.findOne();
  assert.equal(history.statusApplied, false);
  assert.equal(history.source.receivedAt.toISOString(), '2026-10-16T01:00:00.000Z');
  assert.equal(history.scheduledTime.toISOString(), '2026-10-21T13:00:00.000Z');
});

test('accepting an old pending email also preserves the newer status', async () => {
  user.syncMode = 'strict'; await user.save();
  const original = await seedApplication({ status: 'offer', lastStatusEventAt: new Date('2026-10-17T03:00:00Z') });
  await fixtureSync(acceptanceEmails.find((f) => f.name === 'rejection'));
  const item = await PendingItem.findOne();
  const result = await reviewPendingItem({ id: item._id, userId: user._id, action: 'accept' });
  assert.equal(result.statusApplied, false);
  assert.equal((await Job.findById(original._id)).status, 'offer');
  assert.equal((await PendingItem.findById(item._id)).statusApplied, false);
});

test('a manual status watermark and equal timestamps prevent stale/conflicting overwrites', async () => {
  const original = await seedApplication({ status: 'offer', lastStatusEventAt: new Date('2026-10-17T01:00:00Z') });
  const result = await fixtureSync(acceptanceEmails.find((f) => f.name === 'rejection'));
  assert.equal(result.historical, 1);
  assert.equal((await Job.findById(original._id)).status, 'offer');
});

test('concurrent distinct emails for the same new application create one job and retain the newest status', async () => {
  const second = await MailAccount.create({ provider: 'gmail', emailAddress: 'second@example.test', accessToken: 'test-only', userId: user._id });
  const interview = structuredClone(acceptanceEmails.find((f) => f.name === 'interview'));
  const offer = structuredClone(acceptanceEmails.find((f) => f.name === 'offer'));
  offer.message.receivedAt = '2026-10-17T03:00:00Z';
  const results = await Promise.all([fixtureSync(interview), fixtureSync(offer, {}, [second])]);
  assert.equal(results.flatMap((r) => r.errors).length, 0);
  assert.equal(await Job.countDocuments(), 1);
  assert.equal(await StatusHistory.countDocuments(), 2);
  assert.equal((await Job.findOne()).status, 'offer');
});

test('invalid AI dates and confidence go to review instead of failing MongoDB writes', async () => {
  const fixture = structuredClone(acceptanceEmails.find((f) => f.name === 'interview'));
  fixture.extraction.scheduledTime = '2026-02-30T10:00:00Z';
  fixture.extraction.confidence = 5;
  const result = await fixtureSync(fixture);
  assert.equal(result.pendingReview, 1);
  assert.equal(result.failed, 0);
  const item = await PendingItem.findOne();
  assert.equal(item.interviewTime, null);
  assert.ok(item.validationErrors.includes('invalid_scheduledTime'));
  assert.ok(item.validationErrors.includes('invalid_confidence'));
});

test('missing email receive time cannot automatically advance application status', async () => {
  const fixture = structuredClone(acceptanceEmails.find((f) => f.name === 'offer'));
  delete fixture.message.receivedAt;
  const original = await seedApplication();
  const result = await fixtureSync(fixture);
  assert.equal(result.pendingReview, 1);
  const item = await PendingItem.findOne();
  const accepted = await reviewPendingItem({ id: item._id, userId: user._id, action: 'accept' });
  assert.equal(accepted.statusApplied, false);
  assert.equal((await Job.findById(original._id)).status, 'applied');
});
