// Optional full browser acceptance against a disposable local DB and a fresh
// headless Chrome profile. Run npm run build first. Never connects to the live app/database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import { createJob, addHistory } from '../lib/jobs/jobMutations.js';
import { verifySchedule } from './verify-schedule-ui.mjs';

const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const freePort = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
async function until(check, label, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await check()) return; } catch { /* retry startup/navigation */ }
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
let replica, server, chrome, socket, profile, debugEvaluate, output = '';
try {
  await readFile('.next/BUILD_ID', 'utf8').catch(() => { throw new Error('Run npm run build before browser acceptance.'); });
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replica.getUri();
  await mongoose.connect(uri);
  await Promise.all([User.init(), Job.init(), StatusHistory.init()]);
  const user = await User.create({ email: 'ui-editor@example.test', password: await bcrypt.hash('local-ui-test-only', 4) });
  const foreign = await User.create({ email: 'ui-other@example.test', password: 'not-a-login' });
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const { job } = await createJob(user._id, { company: 'UI Acme', position: 'Engineer', dateApplied: ago(3) });
  await addHistory(user._id, job._id, { status: 'interviewing', date: ago(2), interviewStage: 'Phone Screen' });
  await addHistory(user._id, job._id, { status: 'offer', date: ago(1) });
  const { job: foreignJob } = await createJob(foreign._id, { company: 'Private Other', position: 'Private Role' });
  const { job: sibling } = await createJob(user._id, { company: 'UI Sibling', position: 'Other Role' });
  const siblingHistory = await StatusHistory.findOne({ jobId: sibling._id });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // Newer local Node releases expose an experimental server-side localStorage
  // stub. Disable it in this disposable local server, which has no browser storage.
  const nodeFlags = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage') ? ['--no-experimental-webstorage'] : [];
  server = spawn(process.execPath, [...nodeFlags, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, MONGODB_URI: uri, NEXTAUTH_URL: base, NEXTAUTH_SECRET: 'disposable-ui-test-secret', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (data) => { output = (output + data).slice(-16000); });
  await until(async () => (await fetch(`${base}/login`, { signal: AbortSignal.timeout(10000) })).ok, 'local app startup', 90000);
  console.log('Local app and disposable database ready.');
  profile = await mkdtemp(join(tmpdir(), 'jobgenie-ui-chrome-'));
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-extensions',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--no-proxy-server', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const activePortFile = join(profile, 'DevToolsActivePort');
  await until(async () => !!(await readFile(activePortFile, 'utf8')), 'Chrome startup');
  const debugPort = (await readFile(activePortFile, 'utf8')).split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let serial = 0;
  const requests = new Map();
  const exceptions = [];
  let confirmDelete = false;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = requests.get(message.id);
      if (!pending) return;
      requests.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: confirmDelete }).catch(() => {});
    }
  });
  function send(method, params = {}) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { requests.delete(id); reject(new Error(`Chrome timeout: ${method}`)); }, 45000);
      requests.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  debugEvaluate = evaluate;
  const wait = (expression, label) => until(() => evaluate(expression), label);
  const click = (label, scope = 'document', index = 0) => evaluate(`(() => {
    const buttons = [...${scope}.querySelectorAll('button')].filter((button) => button.textContent.trim() === ${JSON.stringify(label)});
    if (!buttons[${index}]) throw new Error('Button missing: ' + ${JSON.stringify(label)});
    buttons[${index}].click();
  })()`);
  const fill = (selector, value) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('Input missing');
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const dialogCount = (count) => wait(`document.querySelectorAll('dialog[open]').length === ${count}`, `${count} open dialogs`);
  const escape = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  };
  const card = `document.querySelector('[data-rfd-draggable-id="${job._id}"]')`;
  await send('Runtime.enable'); await send('Page.enable');
  console.log('Fresh headless Chrome connected.');
  await send('Page.navigate', { url: `${base}/login` });
  await wait('!!document.querySelector("#email")', 'login form');
  await wait(`(() => {
    const form = document.querySelector('form');
    return !!form && Object.keys(form).some((key) => key.startsWith('__reactProps') && typeof form[key].onSubmit === 'function');
  })()`, 'login hydration');
  await fill('#email', user.email); await fill('#password', 'local-ui-test-only');
  await click('Sign in');
  await wait(`!!${card}`, 'authenticated board');
  console.log('PASS: real credential login and board load.');

  await click('Edit Job', card);
  await dialogCount(1);
  await fill('dialog input[name="company"]', 'UI Acme Updated');
  await fill('dialog input[name="position"]', 'Senior Engineer');
  await fill('dialog input[name="location"]', 'Remote');
  await fill('dialog textarea[name="notes"]', 'Persistent UI notes');
  await fill('dialog input[name="jobUrl"]', 'https://example.test/jobs/42');
  // Fail exactly one save at the network boundary; the form must stay editable.
  await send('Fetch.enable', { patterns: [{ urlPattern: `*/api/jobs/${job._id}`, requestStage: 'Request' }] });
  let failNextSave = true;
  const interceptJobSave = (event) => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (failNextSave && request.method === 'PATCH') {
      failNextSave = false;
      send('Fetch.fulfillRequest', { requestId, responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ error: 'Simulated save failure' })).toString('base64') }).catch(() => {});
    } else send('Fetch.continueRequest', { requestId }).catch(() => {});
  };
  socket.addEventListener('message', interceptJobSave);
  await click('Save Changes', 'document.querySelector("dialog[open]")');
  await wait('document.querySelector("dialog [role=alert]")?.textContent.includes("Simulated save failure")', 'failed-save message');
  assert.equal((await Job.findById(job._id)).company, 'UI Acme');
  assert.equal(await evaluate('document.querySelector("dialog input[name=company]").value'), 'UI Acme Updated');
  await send('Fetch.disable');
  socket.removeEventListener('message', interceptJobSave);
  await click('Save Changes', 'document.querySelector("dialog[open]")');
  await dialogCount(0);
  const beforeReload = await evaluate('performance.timeOrigin');
  await send('Page.reload');
  await wait(`performance.timeOrigin !== ${beforeReload}`, 'new document after refresh');
  await wait(`${card}?.textContent.includes('UI Acme Updated')`, 'edited details after reload');
  const saved = await Job.findById(job._id);
  assert.equal(saved.position, 'Senior Engineer'); assert.equal(saved.location, 'Remote');
  assert.equal(saved.notes, 'Persistent UI notes'); assert.equal(saved.jobUrl, 'https://example.test/jobs/42');
  console.log('PASS: save failure retains edits; retry and browser reload retain all five details.');

  await click('Edit Job', card); await dialogCount(1);
  await fill('dialog input[name=company]', 'Cancelled Change');
  await escape();
  await dialogCount(0);
  assert.equal((await Job.findById(job._id)).company, 'UI Acme Updated');
  assert.equal(await evaluate('document.body.style.overflow'), '');
  console.log('PASS: Escape cancels changes and restores page scrolling.');

  await evaluate(`${card}.click()`); await dialogCount(1);
  await wait('document.querySelectorAll("dialog li").length === 3', 'three timeline entries');
  await click('Edit History', 'document.querySelector("dialog[open]")', 2); await dialogCount(2);
  assert.equal(await evaluate('[...document.querySelectorAll("dialog[open]")].at(-1).contains(document.activeElement)'), true);
  await escape();
  await dialogCount(1);
  assert.equal(await evaluate('document.body.style.overflow'), 'hidden');
  await click('Edit History', 'document.querySelector("dialog[open]")', 2); await dialogCount(2);
  await fill('dialog:last-of-type select[name=status]', 'rejected');
  await fill('dialog:last-of-type textarea[name=notes]', 'History changed through UI');
  await click('Save Changes', '[...document.querySelectorAll("dialog[open]")].at(-1)');
  await dialogCount(1);
  await wait('document.querySelector("dialog").textContent.includes("Current status: Rejected")', 'timeline status refresh');
  assert.equal((await Job.findById(job._id)).status, 'rejected');
  assert.match(await evaluate(`${card}.closest('.shadow').querySelector('h2').textContent`), /Rejected/);
  console.log('PASS: nested history editing refreshes timeline and board together.');

  await click('Edit History', 'document.querySelector("dialog[open]")', 2); await dialogCount(2);
  const moved = new Date(ago(2.5));
  const localMoved = new Date(moved.getTime() - moved.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  await fill('dialog:last-of-type input[type=datetime-local]', localMoved);
  await click('Save Changes', '[...document.querySelectorAll("dialog[open]")].at(-1)');
  await dialogCount(1);
  await wait('document.querySelector("dialog").textContent.includes("Current status: Interviewing")', 'reordered current status');
  assert.equal((await Job.findById(job._id)).status, 'interviewing');
  await click('Edit History', 'document.querySelector("dialog[open]")', 2); await dialogCount(2);
  await click('Delete History', '[...document.querySelectorAll("dialog[open]")].at(-1)'); // Cancel first.
  assert.equal(await StatusHistory.countDocuments({ jobId: job._id, deletedAt: null }), 3);
  confirmDelete = true;
  await click('Delete History', '[...document.querySelectorAll("dialog[open]")].at(-1)');
  await dialogCount(1);
  await wait('document.querySelector("dialog").textContent.includes("Current status: Rejected")', 'status after deleting latest');
  assert.equal(await StatusHistory.countDocuments({ jobId: job._id, deletedAt: null }), 2);
  console.log('PASS: moving history dates, cancelling deletion and confirming deletion maintain current state.');

  const foreignRead = await evaluate(`fetch('/api/jobs/${foreignJob._id}').then(response => response.status)`);
  const wrongParent = await evaluate(`fetch('/api/jobs/${job._id}/status-history/${siblingHistory._id}', { method: 'DELETE' }).then(response => response.status)`);
  assert.equal(foreignRead, 404); assert.equal(wrongParent, 404);
  assert.equal((await Job.findById(foreignJob._id)).company, 'Private Other');
  const stats = await evaluate(`fetch('/api/stats?days=7').then(response => response.json())`);
  assert.equal(stats.funnel.rejected, 1); assert.equal(stats.funnel.applied, 1);
  assert.equal(Object.values(stats.timeline).reduce((sum, row) => sum + row.interviewing, 0), 0);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('Edit History', 'document.querySelector("dialog[open]")', 1); await dialogCount(2);
  assert.equal(await evaluate(`(() => {
    const rect = [...document.querySelectorAll('dialog[open]')].at(-1).getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.height <= innerHeight;
  })()`), true);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = join(tmpdir(), 'jobgenie-editing-mobile.png');
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  await verifySchedule({ user, foreign, send, evaluate, wait, click, fill, dialogCount, escape, base, socket });
  await send('Network.clearBrowserCookies');
  assert.equal(await evaluate(`fetch('/api/jobs/${job._id}').then(response => response.status)`), 401);
  assert.equal(await evaluate(`fetch('/api/schedule').then(response => response.status)`), 401);
  assert.deepEqual(exceptions, []);
  console.log(`PASS: HTTP ownership/parent binding, statistics, mobile dialog, unauthenticated access and no uncaught browser errors. Screenshot: ${screenshotPath}`);
} catch (error) {
  console.error(error);
  if (debugEvaluate) {
    console.error('Browser state:', await debugEvaluate('JSON.stringify({ page: location.pathname, text: document.body.innerText.slice(-2500) })').catch(() => 'unavailable'));
  }
  console.error('Local app output (tail):\n' + output.slice(-5000));
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const child of [chrome, server]) {
    if (!child || child.exitCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await mongoose.disconnect();
  if (replica) await replica.stop();
  if (profile) await rm(profile, { recursive: true, force: true });
}
