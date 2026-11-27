import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import bcrypt from 'bcrypt';
import User from '../lib/models/User.js';
import { createJob } from '../lib/jobs/jobMutations.js';

export async function verifyGuideReplay({ user, send, evaluate, wait, click, fill, escape, base }) {
  const directory = process.env.PROGRESS_CAPTURE_DIR || '/private/tmp/jobgenie-guide-captures';
  await fs.mkdir(directory, { recursive: true });
  const guide = 'document.querySelector("[data-onboarding-guide]")';
  const entry = `document.querySelector('[aria-label="Getting started"]')`;
  const preferences = async id => JSON.stringify((await User.findById(id).lean()).webOnboarding);
  async function open() {
    await evaluate(`${entry}.focus(); ${entry}.click()`);
    await wait(`${guide}?.textContent.includes('Step 1 of 3')`, 'manual guide first step');
    assert.equal(await evaluate('document.querySelector("dialog h2").textContent'), 'Getting started');
  }
  async function lastStep() {
    await click('Next'); await click('Next');
    await wait(`${guide}?.textContent.includes('Step 3 of 3')`, 'manual guide final step');
    assert.equal(await evaluate(`${guide}.textContent.includes('Add an application')`), true);
  }
  async function capture(name) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(directory + '/' + name + '.png', Buffer.from(screenshot.data, 'base64'));
  }
  async function login(account) {
    await send('Network.clearBrowserCookies'); await send('Page.navigate', { url: base + '/login' });
    await wait(`!!document.querySelector('#email') && Object.keys(document.querySelector('form') || {}).some(key => key.startsWith('__reactProps') && typeof document.querySelector('form')[key].onSubmit === 'function')`, 'hydrated login');
    await fill('#email', account.email); await fill('#password', 'local-ui-test-only'); await click('Sign in');
    await wait('location.pathname === "/dashboard/jobs" && document.body.innerText.includes("Logout")', 'account dashboard');
    await delay(650);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await preferences(user._id), undefined);
  await open(); await capture('getting-started-desktop');
  await evaluate('window.dispatchEvent(new Event("focus"))'); await delay(400);
  assert.equal(await evaluate(`!!${guide}`), true);
  await click('Next'); await click('Back');
  await wait(`${guide}?.textContent.includes('Step 1 of 3')`, 'manual back navigation');
  await lastStep(); await click('Close');
  await wait(`!${guide}`, 'manual dismissal');
  await wait('fetch("/api/onboarding").then(r=>r.json()).then(d=>d.outcome === "skipped")', 'first manual choice saved');
  const skipped = await preferences(user._id);
  await send('Page.navigate', { url: base + '/dashboard/todo' });
  await wait(`!!${entry}`, 'guide entry on another dashboard page');
  await open(); await lastStep(); await click('Add an application');
  await wait('location.pathname === "/dashboard/add"', 'manual add application destination');
  assert.equal(await preferences(user._id), skipped);
  await evaluate('localStorage.clear()'); await login(user);
  assert.equal(await evaluate(`!!${guide}`), false);
  await open(); await escape(); await wait(`!${guide}`, 'replayed guide Escape');
  assert.equal(await preferences(user._id), skipped);

  const completed = await User.create({ email: 'guide-completed@example.test', password: await bcrypt.hash('local-ui-test-only', 4),
    webOnboarding: { outcome: 'completed', finishedAt: new Date('2026-11-20T12:00:00Z') } });
  await createJob(completed._id, { company: 'Guide Test', position: 'Engineer' });
  const original = await preferences(completed._id);
  await login(completed);
  assert.equal(await evaluate(`!!${guide}`), false);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`(() => { const rect=${entry}.getBoundingClientRect(); return rect.left>=0 && rect.right<=innerWidth && rect.height>=44; })()`), true);
  await open(); await lastStep(); await capture('getting-started-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  for (const shift of [false, true]) for (let count = 0; count < 7; count++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
    assert.equal(await evaluate('document.querySelector("dialog[open]").contains(document.activeElement)'), true);
  }
  await escape(); await wait(`!${guide}`, 'completed account closes replay');
  assert.equal(await preferences(completed._id), original);
  await wait(`document.activeElement === ${entry}`, 'guide entry regains keyboard focus');
  await evaluate(`document.querySelector('[aria-label="Rate JobGenie"]').click()`);
  await wait('!!document.querySelector("[data-feedback-form]")', 'feedback dialog');
  await evaluate(`${entry}.click()`); assert.equal(await evaluate(`!!${guide}`), false);
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 1);
  await click('Not now'); await wait('!document.querySelector("dialog[open]")', 'feedback closed');
  await open();
  const other = await User.create({ email: 'guide-other@example.test', password: await bcrypt.hash('local-ui-test-only', 4),
    webOnboarding: { outcome: 'skipped', finishedAt: new Date('2026-11-21T12:00:00Z') } });
  const otherOriginal = await preferences(other._id);
  await login(other); assert.equal(await evaluate(`!!${guide}`), false);
  await open(); await click('Close'); await wait(`!${guide}`, 'other account closes replay');
  assert.equal(await preferences(completed._id), original); assert.equal(await preferences(other._id), otherOriginal);
  await fs.writeFile(directory + '/guide-replay-example.json', JSON.stringify({ environment: 'disposable local NextAuth/MongoDB/browser', existingApplicationsCanOpen: true, completedChoicePreserved: true, skippedChoicePreserved: true, originalTimestampsPreserved: true, firstManualChoiceSaved: true, freshLoginAndStorage: true, focusRefreshKeepsReplayOpen: true, otherDashboardEntry: true, accountSwitchIsolation: true, addApplicationDestination: true, modalOverlapPrevented: true, mobileEntryVisible: true, keyboardAndFocusRestoration: true }, null, 2));
  console.log('PASS manual guide entry, repeat viewing, completed/skipped timestamps, first manual choice, refresh/login/account isolation, add destination, competing dialog, mobile entry and keyboard/focus restoration.');
}
