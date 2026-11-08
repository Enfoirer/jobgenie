import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import bcrypt from 'bcrypt';
import User from '../lib/models/User.js';
import FeedbackProfile from '../lib/models/FeedbackProfile.js';
import ProductFeedback from '../lib/models/ProductFeedback.js';
import { feedbackAction, feedbackStatus, FEEDBACK_CAMPAIGN } from '../lib/feedback/feedback.js';

export async function verifyFeedback({ user, foreign, job, send, evaluate, wait, click, fill, escape, base, socket }) {
  const directory = process.env.PROGRESS_CAPTURE_DIR || await fs.mkdtemp(path.join(tmpdir(), 'jobgenie-web-feedback-'));
  await fs.mkdir(directory, { recursive: true });
  const capture = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(directory, name), Buffer.from(data, 'base64'));
  };
  const until = async (check, label, timeout = 50000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await check()) return; await delay(300); }
    throw new Error('Timed out: ' + label);
  };
  const open = async () => {
    await evaluate('document.querySelector("button[aria-label=\\"Rate JobGenie\\"]").click()');
    await wait('!!document.querySelector("[data-feedback-form]") && !document.body.textContent.includes("Loading your previous feedback…")', 'feedback form');
  };
  const rate = async (overall, recommendation) => {
    await evaluate(`document.querySelector('input[name="overall"][value="${overall}"]').click()`);
    await evaluate(`document.querySelector('input[name="recommendation"][value="${recommendation}"]').click()`);
  };
  const noDialog = () => wait('!document.querySelector("dialog[open]")', 'feedback closed');
  const reload = async () => {
    const origin = await evaluate('performance.timeOrigin'); await send('Page.reload');
    await wait(`performance.timeOrigin !== ${origin} && !!document.querySelector('button[aria-label="Rate JobGenie"]')`, 'authenticated reload');
  };
  await Promise.all([FeedbackProfile.init(), ProductFeedback.init()]);
  const mature = async id => {
    const now = Date.now(), day = 86400000;
    await FeedbackProfile.findByIdAndUpdate(id, { $set: { campaign: FEEDBACK_CAMPAIGN, firstSeenAt: new Date(now - 7 * day - 1000), activeDays: [-7, -2, 0].map(offset => new Date(now + offset * day).toISOString().slice(0, 10)) } }, { upsert: true });
  };
  await mature(user._id); await reload();
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.bringToFront');
  assert.equal(await evaluate('document.visibilityState === "visible" && document.hasFocus()'), true);
  const card = `document.querySelector('[data-rfd-draggable-id="${job._id}"]')`;
  await wait(`!!${card}`, 'board ready for editor');
  await click('Edit Job', card);
  await wait('document.querySelector("dialog[open]")?.textContent.includes("Edit Job")', 'existing editor');
  console.log('Checking real foreground timing with an existing editor open; no timing bypass.');
  for (let part = 0; part < 5; part++) {
    await delay(26000);
    assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 1);
    assert.equal((await FeedbackProfile.findById(user._id)).invitations.length, 0);
  }
  await escape(); await noDialog();
  await until(() => evaluate('!!document.querySelector("[data-feedback-form]")'), 'invitation after safe idle', 55000);
  assert.equal(await evaluate('document.querySelectorAll("[data-feedback-form] input:checked").length'), 0);
  assert.equal(await evaluate('document.querySelector("[data-feedback-form] button[type=submit]").disabled'), true);
  await until(async () => Boolean((await FeedbackProfile.findById(user._id)).invitations[0]?.shownAt), 'display acknowledgment');
  await click('Not now', 'document.querySelector("[data-feedback-form]")'); await noDialog();
  await until(async () => (await FeedbackProfile.findById(user._id)).invitations[0]?.disposition === 'later', 'saved later');
  const nativeSnooze = await feedbackStatus(user._id);
  assert(Date.parse(nativeSnooze.snoozedUntil) > Date.now() + 13 * 86400000);
  assert.equal((await FeedbackProfile.findById(user._id)).invitations[0].platform, 'web');
  console.log('PASS: two real foreground minutes do not interrupt an editor; safe-idle invitation, no preset stars, shown receipt and shared snooze.');

  await open(); await rate(1, 2);
  await fill('#feedback-comment', 'Please improve keyboard navigation.');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/feedback', requestStage: 'Request' }] });
  let failSubmit = true;
  const intercept = event => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const action = request.postData ? JSON.parse(request.postData).action : null;
    if (failSubmit && action === 'submit') {
      failSubmit = false;
      void send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"Simulated feedback failure"}').toString('base64') });
    } else void send('Fetch.continueRequest', { requestId });
  };
  socket.addEventListener('message', intercept);
  await click('Send feedback', 'document.querySelector("[data-feedback-form]")');
  await wait('document.querySelector("[data-feedback-form] [role=alert]")?.textContent.includes("Simulated feedback failure")', 'feedback failure');
  assert.equal(await evaluate('document.querySelector("#feedback-comment").value'), 'Please improve keyboard navigation.');
  assert.equal(await ProductFeedback.countDocuments({ userId: user._id }), 0);
  await send('Fetch.disable'); socket.removeEventListener('message', intercept);
  await capture('feedback-desktop.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('(() => { const r = document.querySelector("dialog[open]").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height <= innerHeight && document.documentElement.scrollWidth <= innerWidth; })()'), true);
  assert.equal(await evaluate('document.querySelector("dialog[open]").contains(document.activeElement)'), true);
  await evaluate('document.querySelector("dialog[open]").scrollTop = 0'); await capture('feedback-mobile.png');
  await click('Send feedback', 'document.querySelector("[data-feedback-form]")'); await noDialog();
  await wait('document.querySelector("[data-feedback-notice]")?.textContent.includes("has been saved")', 'submission saved');
  const saved = await ProductFeedback.findOne({ userId: user._id });
  assert.equal(saved.overall, 1); assert.equal(saved.recommendation, 2); assert.equal(saved.platform, 'web'); assert.equal(saved.source, 'manual');
  assert.equal(saved.comment, 'Please improve keyboard navigation.');
  const nativeRetry = await feedbackAction(user._id, { action: 'submit', overall: 5, recommendation: 5, comment: 'Native retry' });
  assert.equal(nativeRetry.response.overall, 1); assert.equal(nativeRetry.response.platform, 'web');
  assert.equal(await ProductFeedback.countDocuments({ userId: user._id }), 1);
  await reload(); await open();
  assert.equal(await evaluate('!!document.querySelector("[data-feedback-received]")'), true);
  assert.equal(await evaluate('!!document.querySelector("[data-feedback-form] button[type=submit]")'), false);
  await click('Close', 'document.querySelector("[data-feedback-form]")'); await noDialog();
  console.log('PASS: failed save preserves text/scores, retry stores one negative web response, native retries cannot overwrite, reload/mobile/focus behavior.');

  const other = await User.create({ email: 'ui-feedback-second@example.test', password: await bcrypt.hash('feedback-local-test-only', 4) });
  await mature(other._id);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click('Logout'); await wait('!!document.querySelector("#email")', 'second account login');
  await wait('Object.keys(document.querySelector("form")).some(k => k.startsWith("__reactProps") && typeof document.querySelector("form")[k].onSubmit === "function")', 'second login hydration');
  await fill('#email', other.email); await fill('#password', 'feedback-local-test-only'); await click('Sign in');
  await wait('location.pathname === "/dashboard/jobs" && !!document.querySelector("button[aria-label=\\"Rate JobGenie\\"]")', 'second account board');
  await open();
  assert.equal(await evaluate('document.querySelectorAll("[data-feedback-form] input:checked").length'), 0);
  assert.equal(await evaluate('document.querySelector("#feedback-comment").value'), '');
  assert.equal(await evaluate('document.body.textContent.includes("Please improve keyboard navigation.")'), false);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/feedback', requestStage: 'Request' }] });
  const offline = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Fetch.requestPaused') void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'InternetDisconnected' });
  };
  socket.addEventListener('message', offline);
  await click('Never show automatically again', 'document.querySelector("[data-feedback-form]")'); await noDialog();
  assert.equal((await FeedbackProfile.findById(other._id)).disabledAt, undefined);
  const localChoice = await evaluate(`JSON.parse(localStorage.getItem('jobgenie.feedback.web.${other._id}.${FEEDBACK_CAMPAIGN}'))`);
  assert.equal(localChoice.action, 'never'); assert.equal(localChoice.pending, true);
  await reload();
  assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false);
  await open(); await click('Not now', 'document.querySelector("[data-feedback-form]")'); await noDialog();
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('jobgenie.feedback.web.${other._id}.${FEEDBACK_CAMPAIGN}')).action`), 'never');
  await send('Fetch.disable'); socket.removeEventListener('message', offline);
  await evaluate('window.dispatchEvent(new Event("online"))');
  await until(async () => Boolean((await FeedbackProfile.findById(other._id)).disabledAt), 'offline opt-out synchronization');
  assert.equal((await feedbackStatus(other._id)).disabled, true);
  const native = await feedbackAction(other._id, { action: 'submit', overall: 4, recommendation: 5, comment: 'Native device feedback' });
  assert.equal(native.response.platform, 'ios');
  await open();
  await wait('document.querySelector("[data-feedback-received]")?.textContent.includes("Native device feedback")', 'iOS feedback visible on web');
  assert.equal(await ProductFeedback.countDocuments({ userId: other._id }), 1);
  assert.equal(await FeedbackProfile.countDocuments({ _id: foreign._id }), 0);
  assert.equal(await ProductFeedback.countDocuments({ userId: foreign._id }), 0);
  await click('Close', 'document.querySelector("[data-feedback-form]")'); await noDialog();
  await send('Network.clearBrowserCookies');
  assert.equal(await evaluate('fetch("/api/feedback").then(r => r.status)'), 401);
  await fs.writeFile(path.join(directory, 'feedback-api-example.json'), JSON.stringify({ environment: 'temporary local Next.js/MongoDB and headless Chrome', webResponse: { overall: saved.overall, recommendation: saved.recommendation, source: saved.source, platform: saved.platform, comment: saved.comment }, webResponseCount: 1, legacyIosRetryPreservedWebResponse: true, nativeResponseReadByWeb: { overall: 4, recommendation: 5, platform: 'ios' }, snoozeSharedWithIos: true, pendingOptOutSurvivedReload: true, optOutSynchronized: true, foreignAccountUnchanged: true, signedOutStatus: 401 }, null, 2));
  console.log('PASS: offline never survives reload and syncs, old account data is cleared, native answers are read-only on web, ownership and authentication.');
  console.log(`Feedback browser evidence: ${directory}`);
}
