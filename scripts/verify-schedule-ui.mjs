// Invoked by the shared disposable-database browser harness (npm run test:ui).
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import { createJob, addHistory } from '../lib/jobs/jobMutations.js';

export async function verifySchedule({ user, foreign, send, evaluate, wait, click, fill, dialogCount, escape, base, socket }) {
  await escape(); await escape(); await dialogCount(0);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  const relative = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const future = relative(2), past = relative(-1), moved = relative(4);
  const { job } = await createJob(user._id, { company: 'Calendar Acme', position: 'Engineer', dateApplied: relative(-10) });
  const { statusHistory: interview } = await addHistory(user._id, job._id, {
    status: 'interviewing', date: relative(-8), scheduledTime: future, interviewStage: 'Phone Screen',
  });
  const { statusHistory: missing } = await addHistory(user._id, job._id, { status: 'interviewing', date: relative(-7), notes: 'Missing appointment' });
  await addHistory(user._id, job._id, { status: 'offer', date: relative(-6) });
  const { job: assessment } = await createJob(user._id, { company: 'Calendar Assessment', position: 'Developer', dateApplied: relative(-10) });
  await addHistory(user._id, assessment._id, { status: 'interviewing', interviewStage: 'Online Assessment', date: relative(-8), deadline: past });
  const { job: hidden } = await createJob(foreign._id, { company: 'Hidden Calendar', position: 'Private' });
  await addHistory(foreign._id, hidden._id, { status: 'interviewing', scheduledTime: future });
  // This phase runs after editing acceptance. Remove its remaining unscheduled
  // interviewing records to keep the calendar fixture's counts explicit.
  await StatusHistory.updateMany({ userId: user._id, jobId: { $nin: [job._id, assessment._id] }, status: 'interviewing' }, { $set: { deletedAt: new Date() } });
  const ready = () => wait(`document.querySelector('section[aria-label="Schedule list"]')?.getAttribute('aria-busy') === 'false'`, 'schedule loaded');
  const counts = async (upcoming, overdue, unscheduled) => {
    await wait(`document.querySelector('[data-count=upcoming]')?.textContent === '${upcoming}'
      && document.querySelector('[data-count=overdue]')?.textContent === '${overdue}'
      && document.querySelector('[data-count=unscheduled]')?.textContent === '${unscheduled}'`, 'schedule counts');
  };
  const filter = async (name) => evaluate(`document.querySelector('[data-filter=${name}]').click()`);
  const eventScope = (id, kind = 'appointment') => `document.querySelector('[data-event-id="${id}:${kind}"]')`;
  const localValue = (iso) => evaluate(`(() => { const date = new Date(${JSON.stringify(iso)}); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,19); })()`);
  const localDay = (iso) => evaluate(`new Intl.DateTimeFormat('en-CA').format(new Date(${JSON.stringify(iso)}))`);

  await send('Page.navigate', { url: `${base}/dashboard/todo` });
  await ready(); await counts(1, 1, 1);
  const api = await evaluate(`fetch('/api/schedule').then(response => response.json())`);
  assert.equal(api.events.length, 3);
  assert.ok(api.events.every((event) => event.company !== 'Hidden Calendar'));
  assert.match(await evaluate('document.body.innerText'), /Asia\/Shanghai/);
  assert.match(await evaluate(`${eventScope(interview._id)}.textContent`), /Application: Offer/);
  // Move to the appointment's month even if the fixture crosses a month boundary.
  const futureMonth = await evaluate(`new Date(${JSON.stringify(future)}).getMonth()`);
  const thisMonth = await evaluate('new Date().getMonth()');
  if (futureMonth !== thisMonth) await evaluate(`document.querySelector('[aria-label="Next month"]').click()`);
  const futureDay = await localDay(future);
  assert.match(await evaluate(`document.querySelector('[data-day="${futureDay}"]').textContent`), /Calendar Acme/);
  await evaluate(`document.querySelector('[data-day="${futureDay}"] > button').click()`);
  await wait(`!!${eventScope(interview._id)}`, 'selected day list');
  await click('Clear day filter');
  console.log('PASS: calendar uses appointment time in browser time zone, retains Offer applications, separates missing dates and hides other owners.');

  await filter('unscheduled');
  await click('Edit / delete', eventScope(missing._id)); await dialogCount(1);
  await fill('dialog input[name=scheduledTime]', await localValue(moved));
  await click('Save Changes', 'document.querySelector("dialog[open]")');
  await dialogCount(0); await counts(2, 1, 0);
  assert.equal((await StatusHistory.findById(missing._id)).scheduledTime.toISOString().slice(0, 19), moved.slice(0, 19));
  assert.equal((await Job.findById(job._id)).status, 'offer');
  await filter('upcoming');
  await click('Edit / delete', eventScope(missing._id)); await dialogCount(1);
  await fill('dialog input[name=scheduledTime]', await localValue(past));
  await click('Save Changes', 'document.querySelector("dialog[open]")');
  await dialogCount(0); await counts(1, 2, 0);
  await filter('overdue');
  await click('Edit / delete', eventScope(missing._id)); await dialogCount(1);
  await fill('dialog input[name=scheduledTime]', '');
  await click('Save Changes', 'document.querySelector("dialog[open]")');
  await dialogCount(0); await counts(1, 1, 1);
  const before = await evaluate('performance.timeOrigin');
  await send('Page.reload');
  await wait(`performance.timeOrigin !== ${before}`, 'schedule refresh navigation');
  await ready(); await counts(1, 1, 1);
  console.log('PASS: schedule edits move between upcoming, elapsed and missing-time lists; clearing a time persists after browser reload without changing application status.');

  await filter('unscheduled');
  await click('Edit / delete', eventScope(missing._id)); await dialogCount(1);
  await click('Delete History', 'document.querySelector("dialog[open]")');
  await dialogCount(0); await counts(1, 1, 0);
  assert.ok((await StatusHistory.findById(missing._id)).deletedAt);
  assert.equal((await Job.findById(job._id)).status, 'offer');
  // Edit from the timeline, then return through the application's navigation.
  await evaluate(`document.querySelector('a[href="/dashboard/jobs"]').click()`);
  const card = `document.querySelector('[data-rfd-draggable-id="${job._id}"]')`;
  await wait(`!!${card}`, 'board after calendar delete');
  await evaluate(`${card}.click()`); await dialogCount(1);
  await wait(`document.querySelectorAll('dialog li').length === 3`, 'timeline excludes deleted schedule');
  await click('Edit History', 'document.querySelector("dialog[open]")', 1); await dialogCount(2);
  await fill('dialog:last-of-type input[name=scheduledTime]', await localValue(moved));
  await click('Save Changes', '[...document.querySelectorAll("dialog[open]")].at(-1)');
  await dialogCount(1); await escape(); await dialogCount(0);
  await evaluate(`document.querySelector('a[href="/dashboard/todo"]').click()`);
  await ready(); await counts(1, 1, 0);
  const refreshed = await evaluate(`fetch('/api/schedule').then(response => response.json())`);
  assert.equal(refreshed.events.find((event) => event.historyId === String(interview._id)).time.slice(0, 19), moved.slice(0, 19));
  console.log('PASS: history deletion and timeline rescheduling immediately feed the same calendar data after client-side navigation.');

  // Create a deadline through the manual status editor, not direct DB writes.
  await evaluate(`document.querySelector('a[href="/dashboard/jobs"]').click()`);
  await wait(`!!${card}`, 'board for manual schedule');
  await click('Update Status', card); await dialogCount(1);
  await fill('dialog select[name=status]', 'interviewing');
  await fill('dialog select[name=interviewStage]', 'Online Assessment');
  await fill('dialog input[name=deadline]', await localValue(future));
  await click('Update Status', 'document.querySelector("dialog[open]")'); await dialogCount(0);
  await evaluate(`document.querySelector('a[href="/dashboard/todo"]').click()`);
  await ready(); await counts(2, 1, 0);
  assert.ok((await evaluate(`fetch('/api/schedule').then(response => response.json())`)).events.some((event) => event.label === 'Assessment deadline' && event.time.slice(0, 19) === future.slice(0, 19)));

  // Failed reads expose an explicit retry and retain the last successful data.
  const failRead = (messageEvent) => {
    const message = JSON.parse(messageEvent.data);
    if (message.method === 'Fetch.requestPaused') send('Fetch.fulfillRequest', {
      requestId: message.params.requestId, responseCode: 503,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{}').toString('base64'),
    }).catch(() => {});
  };
  socket.addEventListener('message', failRead);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/schedule', requestStage: 'Request' }] });
  await click('Refresh');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('Unable to load')`, 'schedule read error');
  await counts(2, 1, 0);
  await send('Fetch.disable'); socket.removeEventListener('message', failRead);
  await click('Refresh');
  await wait(`!document.querySelector('[role=alert]')`, 'retry clears schedule error');
  await ready();
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const path = join(tmpdir(), 'jobgenie-calendar-mobile.png');
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  console.log(`PASS: manual assessment creation, failed-load retry and 390px mobile calendar. Screenshot: ${path}`);
}
