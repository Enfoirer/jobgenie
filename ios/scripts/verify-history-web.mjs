// Same disposable database as the native UI acceptance. Never uses a real profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyHistoryWeb({ base, jobID, foreignJobID, foreignHistoryID, work }) {
  const profile = await mkdtemp(join(tmpdir(), 'jobgenie-native-web-'));
  let chrome, socket;
  const pending = new Map();
  async function until(check, label) {
    for (let i = 0; i < 150; i++) { try { if (await check()) return; } catch {} await delay(200); }
    throw new Error(`Timeout: ${label}`);
  }
  try {
    chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain',
      '--password-store=basic', '--disable-background-networking', '--disable-extensions', '--no-proxy-server',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    await until(async () => !!await readFile(portFile, 'utf8'), 'Chrome');
    const port = (await readFile(portFile, 'utf8')).split('\n')[0];
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let serial = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method)); }, 30000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
      return result.result.value;
    };
    const wait = (expression, label) => until(() => evaluate(expression), label);
    const fill = (selector, value) => evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const click = (label, scope = 'document', index = 0) => evaluate(`[...${scope}.querySelectorAll('button')].filter(b => b.textContent.trim() === ${JSON.stringify(label)})[${index}].click()`);
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: `${base}/login` });
    await wait(`(() => { const f=document.querySelector('form'); return f && Object.keys(f).some(k => k.startsWith('__reactProps') && typeof f[k].onSubmit === 'function'); })()`, 'login hydration');
    await fill('#email', 'ios-acceptance@example.test'); await fill('#password', 'ios-local-test-password'); await click('Sign in');
    const card = `document.querySelector('[data-rfd-draggable-id="${jobID}"]')`;
    await wait(`!!${card}`, 'native-created application');
    assert.match(await evaluate(`${card}.closest('.shadow').querySelector('h2').textContent`), /Interviewing/);
    await evaluate(`${card}.click()`);
    await wait(`document.querySelector('dialog[open]')?.textContent.includes('Native interview')`, 'native timeline on web');
    assert.equal(await evaluate(`document.querySelectorAll('dialog li').length`), 2);
    assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('Temporary offer')`), false);
    await click('Edit History', 'document.querySelector("dialog[open]")', 1);
    await wait(`document.querySelectorAll('dialog[open]').length === 2`, 'history editor');
    await fill('dialog:last-of-type select[name=status]', 'offer');
    await fill('dialog:last-of-type textarea[name=notes]', 'Web updated history');
    await click('Save Changes', '[...document.querySelectorAll("dialog[open]")].at(-1)');
    await wait(`document.querySelectorAll('dialog[open]').length === 1 && document.querySelector('dialog').textContent.includes('Current status: Offer')`, 'web status recalculation');
    await send('Page.reload');
    await wait(`!!${card}`, 'web reload');
    assert.match(await evaluate(`${card}.closest('.shadow').querySelector('h2').textContent`), /Offer/);
    await evaluate(`${card}.click()`);
    await wait(`document.querySelector('dialog[open]')?.textContent.includes('Web updated history')`, 'web edit after reload');
    const status = (path, method = 'GET', body) => evaluate(`fetch(${JSON.stringify(path)}, { method:${JSON.stringify(method)}, headers:{'Content-Type':'application/json'}, ${body ? `body:JSON.stringify(${JSON.stringify(body)}),` : ''} }).then(r => r.status)`);
    for (const method of ['GET', 'POST']) {
      assert.equal(await status(`/api/jobs/${foreignJobID}/status-history`, method, method === 'POST' ? { status: 'offer' } : undefined), 404);
    }
    for (const parent of [foreignJobID, jobID]) for (const method of ['PATCH', 'DELETE']) {
      assert.equal(await status(`/api/jobs/${parent}/status-history/${foreignHistoryID}`, method, method === 'PATCH' ? { status: 'rejected' } : undefined), 404);
    }
    assert.equal(await status(`/api/jobs/${jobID}/status-history`, 'POST', { status: 'offer', statusApplied: true }), 400);
    for (const [path, method] of [[`/api/jobs/${jobID}/status-history`, 'GET'], [`/api/jobs/${jobID}/status-history`, 'POST'], [`/api/jobs/${jobID}/status-history/${foreignHistoryID}`, 'PATCH'], [`/api/jobs/${jobID}/status-history/${foreignHistoryID}`, 'DELETE']]) {
      assert.equal((await fetch(base + path, { method })).status, 401);
    }
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(work, 'web-history.png'), Buffer.from(screenshot.data, 'base64'));
    console.log('PASS: native history visible after web reload; web edit persisted; owner/parent isolation and unauthenticated history access rejected.');
  } finally {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser closed')); }
    socket?.close();
    if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill('SIGTERM'); await exited; }
    await rm(profile, { recursive: true, force: true });
  }
}
