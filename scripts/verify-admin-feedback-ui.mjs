import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import User from '../lib/models/User.js';
import ProductFeedback from '../lib/models/ProductFeedback.js';

export async function verifyAdminFeedback({ user, send, evaluate, wait, click, fill, base }) {
  const url = `${base}/dashboard/admin/feedback`;
  await send('Page.navigate', { url });
  await wait('document.body.textContent.includes("Administrator access required")', 'ordinary account page denied');
  assert.equal(await evaluate('fetch("/api/admin/feedback").then(r=>r.status)'), 403);
  await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
  await ProductFeedback.create({ _id: 'browser-admin:fixture', userId: user._id, campaign: 'browser-test', overall: 1, recommendation: 2,
    comment: '<img src=x onerror="window.feedbackScriptRan=true"> Please improve navigation.', source: 'manual', platform: 'web', appVersion: '1.2.3', createdAt: new Date('2026-11-13T23:59:59Z') });
  await send('Page.navigate', { url });
  await wait('!!document.querySelector("[data-feedback-item]")', 'administrator feedback list');
  assert.equal(await evaluate('window.feedbackScriptRan === true'), false);
  await fill('input[name=version]', '9.9'); await click('Apply filters');
  await wait('document.body.textContent.includes("No feedback matches")', 'empty version filter');
  await fill('input[name=version]', '1.2.3'); await click('Apply filters');
  await wait('!!document.querySelector("[data-feedback-item]")', 'matching version');
  const directory = process.env.PROGRESS_CAPTURE_DIR || '/private/tmp/jobgenie-admin-feedback-captures';
  await fs.mkdir(directory, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  const desktop = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(`${directory}/admin-feedback-desktop.png`, Buffer.from(desktop.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate('document.querySelector("[data-feedback-item]").scrollIntoView({block:"center"})');
  const capture = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(`${directory}/admin-feedback-mobile.png`, Buffer.from(capture.data, 'base64'));
  await User.updateOne({ _id: user._id }, { $set: { role: 'user' } });
  await click('Refresh feedback');
  await wait('document.querySelector("[role=alert]")?.textContent.includes("Administrator access required")', 'revocation clears feedback');
  assert.equal(await evaluate('document.querySelectorAll("[data-feedback-item]").length'), 0);
  await send('Network.clearBrowserCookies');
  assert.equal(await evaluate('fetch("/api/admin/feedback").then(r=>r.status)'), 401);
  console.log('PASS: actual NextAuth page/API denies ordinary accounts; DB grant works immediately; filters, literal HTML, mobile bounds, role revocation and signed-out 401 passed.');
}
