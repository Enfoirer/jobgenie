// Isolated native UI -> real NextAuth/Next.js -> disposable MongoDB acceptance.
// Run from the repository root after npm run build. No production credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../../lib/models/User.js';
import Job from '../../lib/models/Job.js';
import StatusHistory from '../../lib/models/StatusHistory.js';
import MailAccount from '../../lib/models/MailAccount.js';
import ProcessedEmail from '../../lib/models/ProcessedEmail.js';
import PendingItem from '../../lib/models/PendingItem.js';
import { createJob } from '../../lib/jobs/jobMutations.js';
import { verifyHistoryWeb } from './verify-history-web.mjs';

const device = process.env.IOS_SIMULATOR_ID;
assert(device, 'Set IOS_SIMULATOR_ID from xcrun simctl list devices available.');
const derived = process.env.IOS_DERIVED_DATA || '/private/tmp/jobgenie-ios-build';
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' };
const work = await mkdtemp(join(tmpdir(), 'jobgenie-ios-acceptance-'));
let replica, server, serverOutput = '';
async function run(command, args) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
  const [code] = await once(child, 'exit');
  await writeFile(join(work, `${command.split('/').pop()}-${Date.now()}.log`), output);
  assert.equal(code, 0, output.slice(-12000));
}
try {
  await readFile('.next/BUILD_ID');
  await run('xcodebuild', ['-project', 'ios/JobGenie.xcodeproj', '-scheme', 'JobGenie', '-configuration', 'Debug', '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', derived, 'build-for-testing']);
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replica.getUri();
  await mongoose.connect(uri);
  await Promise.all([User.init(), Job.init(), StatusHistory.init()]);
  const user = await User.create({ email: 'ios-acceptance@example.test', name: 'Native Tester', password: await bcrypt.hash('ios-local-test-password', 4) });
  const foreign = await User.create({ email: 'other-ios@example.test', password: 'not-a-login' });
  const { job: foreignJob } = await createJob(foreign._id, { company: 'Private Other User', position: 'Do not display' });
  const foreignHistory = await StatusHistory.findOne({ jobId: foreignJob._id });
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const flags = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage') ? ['--no-experimental-webstorage'] : [];
  server = spawn(process.execPath, [...flags, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, MONGODB_URI: uri, NEXTAUTH_URL: base, NEXTAUTH_SECRET: 'disposable-native-test-secret', NEXT_TELEMETRY_DISABLED: '1', OPENAI_API_KEY: '', RESEND_API_KEY: '', PASSWORD_RESET_FROM: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', OUTLOOK_CLIENT_ID: '', OUTLOOK_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverOutput = (serverOutput + data).slice(-12000); });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { ready = (await fetch(`${base}/login`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await delay(500);
  }
  assert(ready, serverOutput);
  const products = join(derived, 'Build/Products');
  const files = (await readdir(products)).filter(file => file.endsWith('.xctestrun') && !file.startsWith('native-'));
  assert.equal(files.length, 1, 'Expected one generated test run');
  // Keep beside the original: __TESTROOT__ relative paths must still resolve.
  const runFile = join(products, `native-${Date.now()}.xctestrun`);
  await run('python3', ['-c', `import plistlib,sys
with open(sys.argv[1],'rb') as f: data=plistlib.load(f)
def visit(node):
 if isinstance(node,dict):
  if node.get('BlueprintName') == 'JobGenieUITests' or 'JobGenieUITests.xctest' in str(node.get('TestBundlePath','')):
   node.setdefault('EnvironmentVariables',{})['JOBGENIE_TEST_BASE_URL']=sys.argv[3]
  for value in node.values(): visit(value)
 elif isinstance(node,list):
  for value in node: visit(value)
visit(data)
with open(sys.argv[2],'wb') as f: plistlib.dump(data,f)
`, join(products, files[0]), runFile, base]);
  console.log('Disposable backend ready; running native login/application/history/relaunch/logout acceptance.');
  await run('xcodebuild', ['test-without-building', '-xctestrun', runFile, '-destination', `platform=iOS Simulator,id=${device}`, '-parallel-testing-enabled', 'NO', '-only-testing:JobGenieUITests/JobGenieUITests/testRealBackend', '-resultBundlePath', join(work, 'backend.xcresult')]);
  const jobs = await Job.find({ userId: user._id });
  assert.equal(jobs.length, 1, 'Native test must execute rather than skip');
  assert.equal(jobs[0].company, 'Native Acceptance');
  assert.equal(jobs[0].location, 'Shanghai');
  assert.equal(jobs[0].status, 'interviewing');
  assert.equal(await StatusHistory.countDocuments({ jobId: jobs[0]._id, userId: user._id, deletedAt: null }), 2);
  assert.equal(await StatusHistory.countDocuments({ jobId: jobs[0]._id, userId: user._id, deletedAt: { $ne: null } }), 1);
  assert.equal((await StatusHistory.findOne({ jobId: jobs[0]._id, notes: 'Native interview' })).interviewStage, 'Assessment');
  const nativeHistory = await StatusHistory.findOne({ jobId: jobs[0]._id, notes: 'Native interview' });
  assert(nativeHistory.scheduledTime instanceof Date);
  assert(nativeHistory.deadline instanceof Date);
  assert.equal(nativeHistory.reminderRevision.appointment, 1);
  assert.equal(nativeHistory.reminderRevision.deadline, 1);
  assert.equal(await Job.countDocuments({ userId: foreign._id }), 1);
  console.log('PASS: native history create/edit/delete, correct fallback, Keychain relaunch persistence and local sign-out.');
  await verifyHistoryWeb({ base, jobID: String(jobs[0]._id), foreignJobID: String(foreignJob._id), foreignHistoryID: String(foreignHistory._id), work });
  assert.equal((await Job.findById(jobs[0]._id)).status, 'offer');
  assert.equal((await StatusHistory.findById(foreignHistory._id)).status, 'applied');
  assert.equal(await StatusHistory.countDocuments({ jobId: foreignJob._id }), 1);
  assert.equal(await StatusHistory.countDocuments({ jobId: jobs[0]._id }), 3);
  await run('xcodebuild', ['test-without-building', '-xctestrun', runFile, '-destination', `platform=iOS Simulator,id=${device}`, '-parallel-testing-enabled', 'NO', '-only-testing:JobGenieUITests/JobGenieUITests/testWebHistoryRefresh', '-resultBundlePath', join(work, 'web-to-native.xcresult')]);
  const cleared = await StatusHistory.findById(nativeHistory._id);
  assert.equal(cleared.scheduledTime, null);
  assert.equal(cleared.deadline, null);
  assert.equal((await Job.findById(jobs[0]._id)).status, 'offer');
  console.log('PASS: native schedule persisted across relaunch; web reschedule/clear visible in App; App clear persisted without changing Offer.');
  await Promise.all([MailAccount.init(), ProcessedEmail.init(), PendingItem.init()]);
  await User.updateOne({ _id: user._id }, { $set: { syncMode: 'strict' } });
  const account = await MailAccount.create({ userId: user._id, provider: 'gmail', emailAddress: 'native-mail@example.test', accessToken: 'test-only-expired', expiresAt: new Date(0) });
  await MailAccount.create({ userId: foreign._id, provider: 'gmail', emailAddress: 'foreign-mail@example.test', accessToken: 'test-only-expired', expiresAt: new Date(0) });
  const receivedAt = new Date(Date.now() - 60000);
  await ProcessedEmail.create({ userId: user._id, accountId: account._id, provider: 'gmail', messageId: 'native-mail-fixture', status: 'failed', attempts: 1,
    receivedAt, raw: { id: 'native-mail-fixture', subject: 'Application received at Native Mail Co', from: 'hiring@example.test', receivedAt,
      bodyText: 'Thank you for applying. We have received your application.\nCompany: Native Mail Co\nPosition: Engineer' } });
  await PendingItem.create({ userId: user._id, accountId: account._id, provider: 'gmail', messageId: 'ignore-fixture', subject: 'Ignore this fixture', status: 'pending' });
  await run('xcodebuild', ['test-without-building', '-xctestrun', runFile, '-destination', `platform=iOS Simulator,id=${device}`, '-parallel-testing-enabled', 'NO', '-only-testing:JobGenieUITests/JobGenieUITests/testRealMailBackend', '-resultBundlePath', join(work, 'mail.xcresult')]);
  const processed = await ProcessedEmail.findOne({ messageId: 'native-mail-fixture' });
  assert.equal(processed.status, 'succeeded'); assert.equal(processed.attempts, 2);
  const reviewed = await PendingItem.findOne({ messageId: 'native-mail-fixture' });
  assert.equal(reviewed.status, 'accepted');
  assert.equal(await StatusHistory.countDocuments({ jobId: reviewed.jobId }), 1);
  assert.equal((await Job.findById(reviewed.jobId)).company, 'Native Mail Co');
  assert.equal((await PendingItem.findOne({ messageId: 'ignore-fixture' })).status, 'ignored');
  assert.equal((await MailAccount.findById(account._id)).lastSync.errorStages[0], 'ingest');
  assert.equal(await Job.countDocuments({ userId: foreign._id }), 1);
  console.log('PASS: native retry, partial sync result, explicit application review, ignore, relaunch persistence and mailbox owner isolation. No external provider calls.');
  console.log(`Results: ${work}`);
} catch (error) {
  console.error(`Acceptance failed. Logs: ${work}`);
  console.error(serverOutput);
  throw error;
} finally {
  if (server) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
  await mongoose.disconnect();
  await replica?.stop();
}
