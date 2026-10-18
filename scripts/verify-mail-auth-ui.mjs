import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import MailAccount from '../lib/models/MailAccount.js';
import ProcessedEmail from '../lib/models/ProcessedEmail.js';
import PendingItem from '../lib/models/PendingItem.js';
import User from '../lib/models/User.js';
import { requestPasswordReset } from '../lib/auth/passwordReset.js';
const { decode, encode } = createRequire(import.meta.url)('next-auth/jwt');

export async function verifyMailAndAuth({ user, foreign, send, evaluate, wait, click, fill, base }) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await Promise.all([MailAccount.init(), ProcessedEmail.init(), PendingItem.init()]);
  const account = await MailAccount.create({ userId: user._id, provider: 'gmail', emailAddress: user.email, accessToken: 'disposable-never-sent', expiresAt: new Date(0) });
  const hidden = await MailAccount.create({ userId: foreign._id, provider: 'outlook', emailAddress: foreign.email, accessToken: 'foreign-secret' });
  await ProcessedEmail.create({ userId: user._id, accountId: account._id, provider: 'gmail', messageId: 'ui-failed-email', status: 'failed', attempts: 1,
    raw: { id: 'ui-failed-email', provider: 'gmail', subject: 'Application received', bodyText: 'Thank you for applying.\nCompany: UI Mail Acme\nPosition: Engineer', receivedAt: new Date().toISOString() }, lastError: 'private-provider-error' });
  await send('Page.navigate', { url: `${base}/dashboard/mail` });
  await wait(`!!document.querySelector('#mail-sync-title') && document.querySelector('section[aria-labelledby="mail-sync-title"]').textContent.includes('1 failed')`, 'owned queue status');
  const panel = `document.querySelector('section[aria-labelledby="mail-sync-title"]')`;
  assert.equal(await evaluate(`${panel}.textContent.includes(${JSON.stringify(foreign.email)})`), false);
  const foreignRetry = await evaluate(`fetch('/api/mail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry',accountId:'${hidden._id}'})}).then(r=>r.status)`);
  assert.equal(foreignRetry, 404);
  await click('Retry failed', panel);
  await wait(`${panel}.textContent.includes('Sync completed') && ${panel}.textContent.includes('0 failed')`, 'real failed-only retry');
  assert.equal(await ProcessedEmail.countDocuments({ accountId: account._id, status: 'succeeded' }), 1);
  assert.equal(await PendingItem.countDocuments({ accountId: account._id, status: 'pending' }), 1);
  assert.equal((await MailAccount.findById(account._id)).lastSync.totalFetched, 0);
  const oldOrigin = await evaluate('performance.timeOrigin');
  await send('Page.reload'); await wait(`performance.timeOrigin !== ${oldOrigin}`, 'sync result reload');
  await wait(`${panel}?.textContent.includes('Last retry:')`, 'saved result restored');
  await click('Sync account', panel); // Expired fake token fails locally before provider I/O.
  await wait(`${panel}.textContent.includes('Completed with errors') && ${panel}.textContent.includes('Mail download failed')`, 'partial failure feedback');
  assert.equal(await PendingItem.countDocuments({ accountId: account._id }), 1);
  assert.equal(await evaluate(`${panel}.textContent.includes('private-provider-error')`), false);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(tmpdir(), 'jobgenie-mail-sync.png'), Buffer.from(shot.data, 'base64'));
  console.log('PASS: owned sync controls, actual failed-mail retry, saved result after reload, ingest failure feedback and no duplicate review items.');

  const initialSession = await evaluate(`fetch('/api/auth/session').then(r=>r.json())`);
  assert.ok(new Date(initialSession.expires).getTime() - Date.now() <= 12 * 3600000);
  assert.ok(new Date(initialSession.expires).getTime() - Date.now() > 11 * 3600000);
  async function login(password, remember = false) {
    await send('Page.navigate', { url: `${base}/login` });
    await wait(`(() => { const form = document.querySelector('form'); return !!form && Object.keys(form).some(key => key.startsWith('__reactProps') && typeof form[key].onSubmit === 'function'); })()`, 'login hydrated');
    await fill('#email', user.email.toUpperCase()); await fill('#password', password);
    if (remember) await evaluate(`document.querySelector('#remember_me').click()`);
    await click('Sign in');
    await wait(`location.pathname === '/dashboard/jobs' && !!document.querySelector('[data-rfd-droppable-id]')`, 'signed in again');
  }
  await send('Network.clearBrowserCookies');
  await login('local-ui-test-only', true);
  const remembered = await evaluate(`fetch('/api/auth/session').then(r=>r.json())`);
  assert.ok(new Date(remembered.expires).getTime() - Date.now() > 29 * 86400000);
  assert.equal((await evaluate(`fetch('/api/auth/session').then(r=>r.json())`)).expires, remembered.expires);
  const cookies = (await send('Network.getCookies', { urls: [base] })).cookies;
  const cookie = cookies.find((item) => item.name === 'next-auth.session-token');
  const token = await decode({ token: cookie.value, secret: 'disposable-ui-test-secret' });
  assert.equal(token.exp, token.authExpiresAt);
  const expired = await encode({ token: { ...token, authExpiresAt: Math.floor(Date.now() / 1000) - 1 }, secret: 'disposable-ui-test-secret' });
  await send('Network.setCookie', { name: cookie.name, value: expired, url: base, httpOnly: true, sameSite: 'Lax' });
  assert.equal(await evaluate(`fetch('/api/mail/status').then(r=>r.status)`), 401);
  await login('local-ui-test-only');
  console.log('PASS: real login honors 12-hour / 30-day choice, normalized emails, fixed JWT expiry and server rejection of expired sessions.');

  await send('Page.navigate', { url: `${base}/login` });
  await wait(`!!document.querySelector('a[href="/forgot-password"]')`, 'recovery link');
  await evaluate(`document.querySelector('a[href="/forgot-password"]').click()`);
  await wait(`!!document.querySelector('#recovery-email')`, 'recovery form');
  await fill('#recovery-email', user.email); await click('Send reset link');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('temporarily unavailable')`, 'unconfigured sender feedback');
  // Exercise the same production service with a fake transport; never send real test mail.
  let resetURL;
  await requestPasswordReset(user.email, { origin: base, send: async ({ url }) => { resetURL = url; } });
  await send('Page.navigate', { url: resetURL });
  await wait(`!!document.querySelector('#new-password') && !document.querySelector('button').disabled`, 'reset form');
  await fill('#new-password', 'replacement-ui-password'); await fill('#confirm-password', 'different-password');
  await click('Update password');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('do not match')`, 'confirmation mismatch');
  await fill('#confirm-password', 'replacement-ui-password'); await click('Update password');
  await wait(`document.querySelector('[role=status]')?.textContent.includes('Password updated')`, 'successful password reset');
  assert.equal(await evaluate('location.hash'), '');
  assert.equal(await evaluate(`fetch('/api/mail/status').then(r=>r.status)`), 401);
  assert.equal((await User.findById(user._id)).authVersion, 1);
  await send('Page.navigate', { url: resetURL });
  await wait(`!!document.querySelector('#new-password') && !document.querySelector('button').disabled`, 'reused reset form');
  await fill('#new-password', 'another-password'); await fill('#confirm-password', 'another-password'); await click('Update password');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('invalid or expired')`, 'one-use token');
  await login('replacement-ui-password');
  console.log('PASS: forgot-password navigation, unavailable sender feedback, reset confirmation, real password change, link replay denial, session revocation and new-password login.');
}
