import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import bcrypt from 'bcrypt';
import User from '../lib/models/User.js';

export async function verifyOnboarding({ user, send, evaluate, wait, click, fill, escape, base, socket }) {
  const directory = process.env.PROGRESS_CAPTURE_DIR || '/private/tmp/jobgenie-onboarding-captures';
  await fs.mkdir(directory, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.deepEqual(await evaluate('fetch("/api/onboarding").then(r=>r.json())'), { eligible: false, outcome: null });
  await delay(650);
  assert.equal(await evaluate('!!document.querySelector("[data-onboarding-guide]")'), false);
  const password = 'local-ui-test-only';
  const first = await User.create({ email: 'guide-first@example.test', password: await bcrypt.hash(password, 4) });
  const second = await User.create({ email: 'guide-second@example.test', password: await bcrypt.hash(password, 4) });
  const third = await User.create({ email: 'guide-third@example.test', password: await bcrypt.hash(password, 4) });
  async function login(account) {
    await send('Network.clearBrowserCookies');
    await send('Page.navigate', { url: base + '/login' });
    await wait(`!!document.querySelector('#email') && Object.keys(document.querySelector('form') || {}).some(key => key.startsWith('__reactProps') && typeof document.querySelector('form')[key].onSubmit === 'function')`, 'hydrated login');
    await fill('#email', account.email); await fill('#password', password); await click('Sign in');
    await wait('location.pathname === "/dashboard/jobs" && document.body.innerText.includes("Logout")', 'new account dashboard');
  }
  async function capture(name) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(directory + '/' + name + '.png', Buffer.from(screenshot.data, 'base64'));
  }
  const guide = 'document.querySelector("[data-onboarding-guide]")';
  await login(first);
  await wait(`${guide}?.textContent.includes('Track your applications')`, 'first onboarding step');
  await capture('onboarding-desktop');
  assert.equal(await evaluate('document.querySelector("dialog[open]").contains(document.activeElement)'), true);
  await click('Next');
  await wait(`${guide}?.textContent.includes('Stay on top of deadlines')`, 'second onboarding step');
  await click('Back'); await wait(`${guide}?.textContent.includes('Track your applications')`, 'back navigation');
  await click('Next'); await click('Next');
  await wait(`${guide}?.textContent.includes('Keep your documents together')`, 'third onboarding step');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`(() => { const d=document.querySelector('dialog[open]'); return d.getBoundingClientRect().left>=0 && d.getBoundingClientRect().right<=innerWidth && d.scrollWidth<=d.clientWidth && document.documentElement.scrollWidth<=innerWidth; })()`), true);
  await capture('onboarding-mobile');
  for (let index = 0; index < 7; index++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate('document.querySelector("dialog[open]").contains(document.activeElement)'), true);
  }
  await click('Create your first application');
  await wait('location.pathname === "/dashboard/add"', 'create application destination');
  await wait('fetch("/api/onboarding").then(r=>r.json()).then(d=>d.outcome === "completed")', 'durable completion');
  assert.equal((await User.findById(first._id)).webOnboarding.outcome, 'completed');
  await evaluate('localStorage.clear()'); await login(first); await delay(900);
  assert.equal(await evaluate(`!!${guide}`), false);

  // Hold the eligibility read while the existing feedback dialog opens.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/onboarding', requestStage: 'Request' }] });
  let pausedGet; let failSave = false;
  const intercept = event => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (request.method === 'GET' && !pausedGet) { pausedGet = requestId; return; }
    if (request.method === 'POST' && failSave) {
      send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"Simulated unavailable preference"}').toString('base64') }).catch(() => {});
    } else send('Fetch.continueRequest', { requestId }).catch(() => {});
  };
  socket.addEventListener('message', intercept);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await login(second);
  await wait(`!!document.querySelector('[aria-label="Rate JobGenie"]')`, 'feedback entry');
  await evaluate(`document.querySelector('[aria-label="Rate JobGenie"]').click()`);
  await wait('!!document.querySelector("[data-feedback-form]")', 'other dialog');
  assert(pausedGet); await send('Fetch.continueRequest', { requestId: pausedGet });
  await delay(800); assert.equal(await evaluate(`!!${guide}`), false);
  await click('Not now'); await wait(`!!${guide}`, 'guide after competing dialog closes');
  failSave = true; await click('Skip');
  await wait('!!document.querySelector("[data-onboarding-notice]")', 'failed save is retryable');
  assert.equal((await User.findById(second._id)).webOnboarding, undefined);
  await send('Fetch.disable'); socket.removeEventListener('message', intercept);
  await click('Retry saving guide choice');
  await wait('!document.querySelector("[data-onboarding-notice]")', 'save retry succeeds');
  assert.equal((await User.findById(second._id)).webOnboarding.outcome, 'skipped');
  await login(second); await delay(800); assert.equal(await evaluate(`!!${guide}`), false);

  await login(third); await wait(`!!${guide}`, 'account isolation');
  await escape(); await wait(`!${guide}`, 'Escape dismisses guide');
  await wait('fetch("/api/onboarding").then(r=>r.json()).then(d=>d.outcome === "skipped")', 'Escape persists skip');
  await send('Page.reload'); await wait('location.pathname === "/dashboard/jobs" && document.body.innerText.includes("Logout")', 'dashboard reload');
  await delay(800); assert.equal(await evaluate(`!!${guide}`), false);
  await send('Network.clearBrowserCookies');
  assert.equal(await evaluate('fetch("/api/onboarding").then(r=>r.status)'), 401);
  assert.equal((await User.findById(user._id)).webOnboarding, undefined);
  await fs.writeFile(directory + '/onboarding-example.json', JSON.stringify({ environment: 'disposable local NextAuth/MongoDB/browser', existingApplicationsSuppressed: true, completedOutcome: 'completed', skippedOutcome: 'skipped', restartAndFreshStoragePersistence: true, accountIsolation: true, competingDialogDeferred: true, failedSaveRetry: true, escapeDismissal: true, mobileWidth: 390, keyboardFocusContained: true, anonymousStatus: 401 }, null, 2));
  console.log('PASS first-use steps/back/completion, existing-user suppression, account isolation, durable completion/skip, competing-dialog deferral, save retry, Escape, mobile layout and keyboard focus.');
}
