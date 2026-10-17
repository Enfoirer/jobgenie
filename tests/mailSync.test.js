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
const parsed = { shouldCreate: true, parsed: { eventType: 'interview', confidence: 0.95 } };
const message = (id = 'mail-1') => ({
  id, provider: 'gmail', subject: 'Interview invitation', snippet: 'Please select a time.',
  bodyText: 'Please select a time.', from: 'recruiter@example.test',
  historyId: '9007199254740993', receivedAt: '2026-10-17T01:00:00Z',
});
const options = (messages = [message()], overrides = {}) => ({
  fetchers: {
    gmail: async () => ({ messages, newHistoryId: '9007199254740993' }),
    outlook: async () => ({ messages }),
  },
  parseEmail: async () => structuredClone(parsed),
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

test('repeated sync creates one job and one history even with no company or position', async () => {
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
