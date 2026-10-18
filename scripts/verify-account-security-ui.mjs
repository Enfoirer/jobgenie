import assert from 'node:assert/strict';
import OAuthAttempt from '../lib/models/OAuthAttempt.js';
import AuthRateLimit from '../lib/models/AuthRateLimit.js';
import User from '../lib/models/User.js';
import { consumeAuthLimit } from '../lib/auth/rateLimit.js';

export async function verifyAccountSecurity({ user, send, evaluate, wait, click, fill, base, socket }) {
  await Promise.all([OAuthAttempt.init(), AuthRateLimit.init()]);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  let intercepted;
  const intercept = (event) => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    intercepted = new URL(message.params.request.url);
    // Simulate provider return without making any request to Google/Microsoft.
    send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 302,
      responseHeaders: [{ name: 'Location', value: `${base}/dashboard/mail` }] }).catch(() => {});
  };
  socket.addEventListener('message', intercept);
  try {
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://accounts.google.com/o/oauth2/v2/auth*' }, { urlPattern: 'https://login.microsoftonline.com/*/oauth2/v2.0/authorize*' }] });
    for (const [provider, button] of [['google', 'Connect Gmail'], ['outlook', 'Connect Outlook']]) {
      intercepted = null;
      await send('Page.navigate', { url: `${base}/dashboard/mail` });
      await wait(`!!document.querySelector('#mail-sync-title') && !document.body.innerText.includes('Loading...')`, 'mail ready');
      await click(button);
      for (let attempts = 0; attempts < 100 && !intercepted; attempts++) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(intercepted, 'provider navigation intercepted');
      const state = intercepted.searchParams.get('state');
      assert.match(state, /^[\w-]{43}$/); assert.equal(intercepted.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(intercepted.searchParams.get('redirect_uri'), `${base}/api/oauth/${provider}/callback`);
      await wait(`location.pathname === '/dashboard/mail' && !!document.querySelector('#mail-sync-title')`, 'simulated return');
      const cookies = (await send('Network.getCookies', { urls: [base] })).cookies;
      const cookie = cookies.find((item) => item.name === `jobgenie-oauth-${provider}`);
      assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, 'Lax');
      assert.equal(await evaluate(`document.cookie.includes('jobgenie-oauth-${provider}')`), false);
      const callback = `${base}/api/oauth/${provider}/callback?state=${state}&error=access_denied`;
      await send('Page.navigate', { url: callback });
      await wait(`document.querySelector('[role=alert]')?.textContent.includes('cancelled')`, 'safe cancellation feedback');
      assert.equal(await OAuthAttempt.countDocuments({ provider, userId: user._id }), 0);
      assert.equal((await send('Network.getCookies', { urls: [base] })).cookies.some((item) => item.name === cookie.name), false);
      await send('Page.navigate', { url: callback });
      await wait(`document.querySelector('[role=alert]')?.textContent.includes('invalid or expired')`, 'replayed callback rejected');
    }
  } finally { await send('Fetch.disable'); socket.removeEventListener('message', intercept); }
  console.log('PASS: real mailbox buttons use server-issued state/PKCE; HttpOnly browser cookies, cancellation, cookie cleanup and replay denial work for both providers without real provider requests.');

  // Use a new target so limits from earlier login acceptance remain independent.
  const email = 'rate-target@example.test';
  await send('Page.navigate', { url: `${base}/login` });
  await wait(`(() => { const form = document.querySelector('form'); return !!form && Object.keys(form).some(key => key.startsWith('__reactProps') && typeof form[key].onSubmit === 'function'); })()`, 'security login form hydrated');
  await fill('#email', email); await fill('#password', 'test-only-password');
  for (let attempt = 0; attempt < 10; attempt++) await consumeAuthLimit(`auth:login:email:${email}`, 10, 900000);
  await click('Sign in');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('Too many sign-in attempts')`, 'login throttle feedback');
  const loginResponse = await evaluate(`(async()=>{
    const {csrfToken}=await fetch('/api/auth/csrf').then(r=>r.json());
    const r=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:${JSON.stringify(email)},password:'test-only-password',csrfToken,json:'true'})});
    return {status:r.status,retry:r.headers.get('Retry-After')};
  })()`);
  assert.equal(loginResponse.status, 429); assert.ok(Number(loginResponse.retry) > 0);
  for (let attempt = 0; attempt < 3; attempt++) await consumeAuthLimit(`auth:register:email:${email}`, 3, 3600000);
  await click('Create Account');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('Too many attempts')`, 'registration throttle feedback');
  assert.equal(await User.countDocuments({ email }), 0);
  const registration = await evaluate(`fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:'test-only-password'})}).then(r=>({status:r.status,retry:r.headers.get('Retry-After')}))`);
  assert.equal(registration.status, 429); assert.ok(Number(registration.retry) > 0);
  // Simulate expiry by clearing only this test's limit collection in the disposable DB.
  await AuthRateLimit.deleteMany({});
  await fill('#email', user.email); await fill('#password', 'replacement-ui-password');
  await click('Sign in');
  await wait(`location.pathname === '/dashboard/jobs' && !!document.querySelector('[data-rfd-droppable-id]')`, 'login after test bucket expiry');
  assert.ok((await evaluate(`fetch('/api/auth/session').then(r=>r.json())`)).user.sessionId);
  console.log('PASS: real NextAuth and registration return 429/Retry-After, UI explains throttling, blocked signups do not create users, and login works after the limit is cleared.');
}
