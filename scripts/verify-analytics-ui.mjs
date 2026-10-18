import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Job from '../lib/models/Job.js';
import { createJob, addHistory } from '../lib/jobs/jobMutations.js';

export async function verifyAnalytics({ user, foreign, send, evaluate, wait, click, fill, base, socket }) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  const at = (day) => `2025-02-${String(day).padStart(2, '0')}T10:00:00Z`;
  const make = async (company, dateApplied = at(1), owner = user) => (await createJob(owner._id, { company, position: 'Engineer', dateApplied })).job;
  const add = async (job, status, date) => (await addHistory(job.userId, job._id, { status, date })).statusHistory;
  const a = await make('Analytics A');
  const first = await add(a, 'interviewing', at(2)), second = await add(a, 'interviewing', at(3));
  await add(a, 'offer', at(4)); await add(a, 'rejected', at(5));
  const b = await make('Analytics B'); await add(b, 'rejected', at(2));
  const c = await make('Analytics Boundary', '2025-01-31T16:00:00Z'); await add(c, 'offer', at(2));
  const old = await make('Analytics Older', '2025-01-01T10:00:00Z'); await add(old, 'interviewing', at(2));
  const hidden = await make('Hidden Analytics', at(1), foreign); await add(hidden, 'offer', at(2));
  const ready = () => wait(`!!document.querySelector('[data-analytics-ready="true"]')`, 'analytics loaded');
  const value = (attribute) => evaluate(`document.querySelector(${JSON.stringify(attribute)})?.textContent`);
  const apply = async (start = '2025-02-01', end = '2025-02-28', zone = 'Asia/Shanghai') => {
    await fill('select[name=range]', 'custom');
    await fill('input[name=start]', start); await fill('input[name=end]', end); await fill('input[name=timeZone]', zone);
    await click('Apply range'); await ready();
    await wait(`document.querySelector('[data-stats-range]')?.textContent.includes(${JSON.stringify(`${start} through ${end} · ${zone}`)})`, 'applied range caption');
  };
  await send('Page.navigate', { url: `${base}/dashboard` });
  await wait(`location.pathname === '/dashboard/analytics'`, 'old dashboard redirects to analytics');
  await ready(); await apply();
  assert.equal(await value('[data-cohort-total]'), '3');
  assert.equal(await value('[data-conversion=appliedToInterview]'), '33.3%');
  assert.equal(await value('[data-conversion=interviewToOffer]'), '100.0%');
  assert.equal(await value('[data-conversion=appliedToOffer]'), '66.7%');
  const currentTotal = await value('[data-current-total]');
  assert.equal(await evaluate(`document.querySelectorAll('[data-progression-id]').length`), 3);
  const api = await evaluate(`fetch('/api/stats?start=2025-02-01&end=2025-02-28&timeZone=Asia/Shanghai').then(response=>response.json())`);
  assert.equal(api.currentStatus.total, Number(currentTotal));
  assert.ok(!JSON.stringify(api).includes('Hidden Analytics'));
  await fill('select[name=chartMetric]', 'applications');
  assert.equal(await value('[data-conversion=appliedToInterview]'), '33.3%');
  await fill('select[name=chartMetric]', 'events');
  console.log('PASS: separate current distribution and cohort conversion, deduplicated rounds, direct offers, owner isolation and chart-only controls.');

  await apply('2025-02-01', '2025-02-28', 'UTC');
  assert.equal(await value('[data-cohort-total]'), '2');
  assert.equal(await value('[data-current-total]'), currentTotal);
  await apply('2025-02-01', '2025-02-03');
  assert.equal(await value('[data-conversion=appliedToOffer]'), '33.3%');
  assert.equal(await value('[data-conversion=interviewToOffer]'), '0.0%');
  assert.equal(await value('[data-current-total]'), currentTotal);
  await fill('input[name=timeZone]', 'Invalid/Zone'); await click('Apply range');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('valid IANA')`, 'invalid time-zone feedback');
  await apply();
  console.log('PASS: timezone changes cohort membership, historical end dates limit progression, current distribution stays current, invalid ranges are recoverable.');

  for (const entry of [first, second]) assert.equal(await evaluate(`fetch('/api/jobs/${a._id}/status-history/${entry._id}', {method:'DELETE'}).then(response=>response.status)`), 200);
  await click('Refresh analytics');
  await wait(`document.querySelector('[data-conversion=appliedToInterview]')?.textContent === '0.0%'`, 'deleted history updates conversion');
  assert.equal(await value('[data-conversion=interviewToOffer]'), '—');
  await apply('2025-01-10', '2025-01-10');
  assert.equal(await value('[data-cohort-total]'), '0');
  assert.equal(await value('[data-conversion=appliedToOffer]'), '—');
  assert.equal(await value('[data-current-total]'), currentTotal);
  await apply();

  let fail = true;
  const intercept = (event) => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId } = message.params;
    if (fail) { fail = false; send('Fetch.fulfillRequest', { requestId, responseCode: 503,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ error: 'Simulated analytics failure' })).toString('base64') }).catch(() => {}); }
    else send('Fetch.continueRequest', { requestId }).catch(() => {});
  };
  socket.addEventListener('message', intercept);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/stats?*', requestStage: 'Request' }] });
  await click('Refresh analytics');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('Simulated analytics failure')`, 'analytics read failure');
  await send('Fetch.disable'); socket.removeEventListener('message', intercept);
  await click('Refresh analytics'); await wait(`!document.querySelector('[role=alert]')`, 'analytics retry'); await ready();

  // Verify the corrected manual date input in a positive-offset time zone.
  await evaluate(`document.querySelector('a[href="/dashboard/add"]').click()`);
  await wait(`!!document.querySelector('#company') && !!document.querySelector('#dateApplied')?.value`, 'add application form');
  await fill('#company', 'Analytics Local Date'); await fill('#position', 'Engineer'); await fill('#dateApplied', '2025-02-15');
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await wait(`location.pathname === '/dashboard/jobs'`, 'application saved');
  const saved = await Job.findOne({ userId: user._id, company: 'Analytics Local Date' });
  assert.equal(saved.dateApplied.toISOString(), '2025-02-14T16:00:00.000Z');
  await evaluate(`document.querySelector('a[href="/dashboard/analytics"]').click()`); await ready();
  await apply('2025-02-15', '2025-02-15');
  assert.equal(await value('[data-cohort-total]'), '1');
  await apply();
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate(`document.querySelector('[aria-label="Activity trend"] details').open = true`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate(`document.querySelector('[aria-label="Activity trend"] details').open = false`);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const path = join(tmpdir(), 'jobgenie-analytics-mobile.png');
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  console.log(`PASS: deletion refresh, empty/zero-denominator state, failed-load retry, local application date persistence and 390px chart/table layout. Screenshot: ${path}`);
}
