import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import UploadedFile from '../lib/models/UploadedFile.js';
import { addHistory } from '../lib/jobs/jobMutations.js';
import { pdf } from '../tests/fixtures/uploads.mjs';

export async function verifyEmptyStates({ user, foreign, send, evaluate, wait, click, base, socket }) {
  const directory = process.env.PROGRESS_CAPTURE_DIR || '/private/tmp/jobgenie-empty-captures';
  await fs.mkdir(directory, { recursive: true });
  const empty = name => `document.querySelector('[data-empty-state="${name}"]')`;
  const navigate = path => send('Page.navigate', { url: base + path });
  async function capture(name, state) {
    await evaluate(`${empty(state)}.scrollIntoView({block:'center'})`);
    for (const [size, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: size === 'mobile' });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(`${directory}/${name}-${size}.png`, Buffer.from(screenshot.data, 'base64'));
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  // Fixtures are isolated to this temporary database. Other-user records remain intact.
  assert.equal(await evaluate(`!!${empty('applications')}`), false);
  await Job.updateMany({ userId: user._id }, { $set: { archivedAt: new Date() } });
  await navigate('/dashboard/jobs');
  await wait(`${empty('applications')}?.textContent.includes('Your applications are archived')`, 'archived-only board');
  await click('View archived applications');
  await wait('!!document.querySelector("[data-rfd-draggable-id]")', 'archived applications visible');
  assert.equal(await evaluate(`!!${empty('applications')}`), false);
  await evaluate(`document.querySelectorAll('input[type=checkbox]')[1].click()`);
  await wait(`${empty('applications')}?.textContent.includes('Your applications are archived')`, 'return to active view');
  await Job.updateMany({ userId: user._id }, { $set: { archivedAt: null, status: 'rejected' } });
  await navigate('/dashboard/jobs');
  await wait('!!document.querySelector("[data-rfd-draggable-id]")', 'rejected board fixture');
  await evaluate(`document.querySelector('input[type=checkbox]').click()`);
  await wait(`${empty('applications')}?.textContent.includes('No applications match this filter')`, 'hidden rejected view');
  assert.equal(await evaluate(`${empty('applications')}.textContent.includes('Create your first application')`), false);
  await click('Show rejected applications');
  await wait('!!document.querySelector("[data-rfd-draggable-id]")', 'filter recovery');
  await evaluate(`document.querySelectorAll('input[type=checkbox]')[1].click()`);
  await wait(`${empty('applications')}?.textContent.includes('No archived applications')`, 'empty archive');
  await click('View active applications');
  await wait('!!document.querySelector("[data-rfd-draggable-id]")', 'active recovery');

  await User.updateOne({ _id: user._id }, { $set: { webOnboarding: { outcome: 'skipped', finishedAt: new Date() } } });
  await Promise.all([Job.deleteMany({ userId: user._id }), StatusHistory.deleteMany({ userId: user._id })]);
  await navigate('/dashboard/jobs');
  await wait(`${empty('applications')}?.textContent.includes('No applications yet')`, 'first application guidance');
  assert.equal(await evaluate('document.querySelectorAll("[data-rfd-draggable-id]").length'), 0);
  assert(await Job.exists({ userId: foreign._id }));
  await capture('applications-empty', 'applications');
  await evaluate(`${empty('applications')}.querySelector('a').click()`);
  await wait('location.pathname === "/dashboard/add" && !!document.querySelector("input")', 'first application entry point');
  const created = await evaluate(`fetch('/api/jobs', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:'Empty State Acme',position:'Engineer',dateApplied:new Date().toISOString()})}).then(async r=>({status:r.status,data:await r.json()}))`);
  assert.equal(created.status, 201);
  const job = await Job.findOne({ userId: user._id }); assert(job);
  await navigate('/dashboard/jobs');
  await wait('!!document.querySelector("[data-rfd-draggable-id]")', 'created application removes empty guidance');
  assert.equal(await evaluate(`!!${empty('applications')}`), false);

  await navigate('/dashboard/todo');
  await wait(`!!${empty('schedule')}`, 'empty schedule guidance');
  await capture('schedule-empty', 'schedule');
  await evaluate(`${empty('schedule')}.querySelector('a').click()`);
  await wait('location.pathname === "/dashboard/jobs" && !!document.querySelector("[data-rfd-draggable-id]")', 'calendar application entry point');
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  await addHistory(user._id, job._id, { status: 'interviewing', date: new Date().toISOString(), interviewStage: 'Phone Screen', scheduledTime: future });
  await navigate('/dashboard/todo');
  await wait('!!document.querySelector("[data-event-id]")', 'existing schedule');
  assert.equal(await evaluate(`!!${empty('schedule')}`), false);
  await evaluate('document.querySelector("[data-filter=overdue]").click()');
  await wait('document.body.innerText.includes("No past events.")', 'empty category');
  assert.equal(await evaluate(`!!${empty('schedule')}`), false);

  // Hold initial reads to inspect loading before returning a simulated server failure.
  let held;
  const intercept = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Fetch.requestPaused') held = message.params.requestId;
  };
  socket.addEventListener('message', intercept);
  async function unavailable(path, endpoint, state, loadingText) {
    held = null;
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/' + endpoint, requestStage: 'Request' }] });
    await navigate(path);
    for (let attempt = 0; !held && attempt < 100; attempt++) await delay(50);
    assert(held, 'Initial request was intercepted');
    await wait(`document.body.innerText.includes(${JSON.stringify(loadingText)})`, 'loading state');
    assert.equal(await evaluate(`!!${empty(state)}`), false);
    await send('Fetch.fulfillRequest', { requestId: held, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{}').toString('base64') });
    await wait(`document.body.innerText.includes(${JSON.stringify(endpoint === 'schedule' ? 'Unable to load your schedule.' : 'Unable to load files.')})`, 'load error');
    assert.equal(await evaluate(`!!${empty(state)}`), false);
    await send('Fetch.disable');
  }
  await unavailable('/dashboard/todo', 'schedule', 'schedule', 'Loading schedule...');
  await click('Refresh');
  await wait('!!document.querySelector("[data-event-id]")', 'schedule retry');

  await UploadedFile.init();
  await UploadedFile.create({ userId: foreign._id, name: 'foreign.pdf', type: 'application/pdf', size: '1 KB', fileData: pdf });
  await navigate('/dashboard/upload');
  await wait(`!!${empty('uploads')}`, 'first resume guidance');
  await capture('uploads-empty', 'uploads');
  const fixture = directory + '/acceptance-resume.pdf'; await fs.writeFile(fixture, pdf);
  let chooserOpened = false;
  const chooser = event => { if (JSON.parse(event.data).method === 'Page.fileChooserOpened') chooserOpened = true; };
  socket.addEventListener('message', chooser);
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await click('Upload your first resume');
  for (let attempt = 0; !chooserOpened && attempt < 100; attempt++) await delay(50);
  assert.equal(chooserOpened, true);
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [fixture] });
  await wait('!!document.querySelector("[data-upload-id]")', 'first resume uploaded');
  assert.equal(await evaluate(`!!${empty('uploads')}`), false);
  assert.deepEqual(Buffer.from((await UploadedFile.findOne({ userId: user._id }).select('+fileData')).fileData), pdf);
  await send('Page.setInterceptFileChooserDialog', { enabled: false }); socket.removeEventListener('message', chooser);
  await click('Delete'); await wait(`!!${empty('uploads')}`, 'last file deletion restores guidance');
  await unavailable('/dashboard/upload', 'uploads', 'uploads', 'Loading files…');
  await click('Refresh files'); await wait(`!!${empty('uploads')}`, 'file load retry');
  socket.removeEventListener('message', intercept);
  await fs.writeFile(directory + '/empty-states-example.json', JSON.stringify({ environment: 'disposable local NextAuth/MongoDB/browser', firstApplicationEntry: true, populatedBoard: true, archivedOnlyRecovery: true, rejectedFilterRecovery: true, emptyArchiveRecovery: true, scheduleEntry: true, existingScheduleAndEmptyCategory: true, firstResumePickerAndUpload: true, lastFileDeletion: true, loadingAndErrorSuppression: true, failedReadRetry: true, widths: [1280, 390], foreignDataExcluded: true }, null, 2));
  console.log('PASS empty application/calendar/upload guidance, existing data, archive/rejected filters, action destinations, native file picker/upload/delete, loading/error distinction, retry and 390px layout.');
}
