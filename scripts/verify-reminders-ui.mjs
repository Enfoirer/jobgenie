import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import StatusHistory from '../lib/models/StatusHistory.js';
import { createJob, addHistory } from '../lib/jobs/jobMutations.js';

export async function verifyReminders({ user, foreign, send, evaluate, wait, click, fill, dialogCount, base, socket }) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const at = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();
  const { job } = await createJob(user._id, { company: 'Reminder Acme', position: 'Engineer', dateApplied: '2020-01-01' });
  const { statusHistory: entry } = await addHistory(user._id, job._id, {
    status: 'interviewing', date: '2020-02-01', scheduledTime: at(30), deadline: at(45),
  });
  const { statusHistory: later } = await addHistory(user._id, job._id, { status: 'interviewing', date: '2020-03-01', scheduledTime: at(120) });
  const { job: hidden } = await createJob(foreign._id, { company: 'Hidden Reminder', position: 'Private' });
  const { statusHistory: foreignEntry } = await addHistory(foreign._id, hidden._id, { status: 'interviewing', scheduledTime: at(30) });
  const scope = (id, kind = 'appointment', revision = 0) => `document.querySelector('[data-reminder-id="${id}:${kind}:${revision}"]')`;
  const count = (value) => wait(`document.querySelector('[data-reminder-count]')?.textContent === '${value}'`, `reminder badge ${value}`);
  const ready = () => wait(`document.querySelector('[aria-label="Reminder list"]')?.getAttribute('aria-busy') === 'false'`, 'reminders loaded');
  const reload = async () => {
    const before = await evaluate('performance.timeOrigin');
    await send('Page.reload'); await wait(`performance.timeOrigin !== ${before}`, 'reminder document reload'); await ready();
  };
  await send('Page.navigate', { url: `${base}/dashboard/reminders` });
  await ready(); await count(2);
  assert.equal(await evaluate('document.querySelector("select[name=leadMinutes]").value'), '60');
  assert.ok(!(await evaluate(`fetch('/api/reminders').then(response => response.text())`)).includes('Hidden Reminder'));
  await click('Mark read', scope(entry._id)); await count(1);
  await reload(); await count(1);
  await click('Handled');
  await wait(`${scope(entry._id)}?.textContent.includes('Read')`, 'read reminder persisted');
  await click('Active');
  await click('Snooze 10 minutes', scope(entry._id, 'deadline')); await count(0);
  await wait(`${scope(entry._id, 'deadline')}?.textContent.includes('Snoozed')`, 'snoozed state');
  const saved = await StatusHistory.findById(entry._id);
  assert.ok(saved.reminderState.deadline.snoozedUntil.getTime() > Date.now() + 9 * 60000);
  await reload(); await count(0);
  // Deterministically expire the fixture's snooze rather than sleeping ten minutes.
  // Unit tests cover exact server-clock boundaries and idempotent retries.
  await StatusHistory.updateOne({ _id: entry._id }, { $set: { 'reminderState.deadline.snoozedUntil': new Date(Date.now() - 1) } });
  await click('Refresh reminders'); await count(1);
  await click('Cancel reminder', scope(entry._id, 'deadline')); await count(0);
  assert.ok((await evaluate(`fetch('/api/schedule').then(response => response.json())`)).events.some((event) => event.historyId === String(entry._id) && event.kind === 'deadline'));
  console.log('PASS: reminder badge, read persistence, snooze/wake and cancellation without deleting the calendar entry.');

  await fill('select[name=leadMinutes]', '1440'); await click('Save settings'); await count(1);
  await ready();
  await wait(`!!${scope(later._id)}`, '24-hour setting widens the window');
  await evaluate(`document.querySelector('input[name=enabled]').click()`);
  await click('Save settings'); await count(0);
  await reload();
  assert.equal(await evaluate(`document.querySelector('input[name=enabled]').checked`), false);
  await evaluate(`document.querySelector('input[name=enabled]').click()`);
  await click('Save settings'); await count(1); await ready();
  await click('Handled');
  await wait(`!!${scope(entry._id)} && !!${scope(entry._id, 'deadline')}`, 'settings keep handled choices');

  // Reschedule the read reminder in the real calendar editor. Its new occurrence
  // must update the global badge immediately without waiting for the poll timer.
  await evaluate(`document.querySelector('a[href="/dashboard/todo"]').click()`);
  await wait(`document.querySelector('[aria-label="Schedule list"]')?.getAttribute('aria-busy') === 'false'`, 'calendar loaded');
  await click('Edit / delete', `document.querySelector('[data-event-id="${entry._id}:appointment"]')`); await dialogCount(1);
  const moved = at(35);
  const local = await evaluate(`(() => { const date = new Date(${JSON.stringify(moved)}); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,19); })()`);
  await fill('dialog input[name=scheduledTime]', local);
  await click('Save Changes', 'document.querySelector("dialog[open]")'); await dialogCount(0); await count(2);
  await evaluate(`document.querySelector('a[href="/dashboard/reminders"]').click()`);
  await ready();
  await wait(`!!${scope(entry._id, 'appointment', 1)}`, 'new occurrence after rescheduling');
  assert.equal(await evaluate(`fetch('/api/reminders', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({historyId:'${entry._id}',kind:'appointment',revision:0,action:'read'})}).then(response=>response.status)`), 409);
  assert.equal(await evaluate(`fetch('/api/reminders', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({historyId:'${foreignEntry._id}',kind:'appointment',revision:0,action:'read'})}).then(response=>response.status)`), 404);
  console.log('PASS: preference persistence, enable/disable, retained handled state, calendar rescheduling, stale-action rejection and HTTP ownership.');

  let failNext = true;
  const intercept = (event) => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (request.method === 'PATCH' && failNext) {
      failNext = false;
      send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ error: 'Simulated reminder save failure' })).toString('base64') }).catch(() => {});
    } else send('Fetch.continueRequest', { requestId }).catch(() => {});
  };
  socket.addEventListener('message', intercept);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/reminders', requestStage: 'Request' }] });
  await click('Mark read', scope(entry._id, 'appointment', 1));
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('Simulated reminder save failure')`, 'failed reminder save');
  await count(2);
  await send('Fetch.disable'); socket.removeEventListener('message', intercept);
  await click('Mark read', scope(entry._id, 'appointment', 1)); await count(1);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const path = join(tmpdir(), 'jobgenie-reminders-mobile.png');
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  console.log(`PASS: reminder save failure/retry, responsive layout and no duplicate action effects. Screenshot: ${path}`);
}
