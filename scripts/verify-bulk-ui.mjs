import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Job from '../lib/models/Job.js';
import StatusHistory from '../lib/models/StatusHistory.js';
import PendingItem from '../lib/models/PendingItem.js';
import { createJob } from '../lib/jobs/jobMutations.js';

export async function verifyBulk({ user, send, evaluate, wait, click, fill, base }) {
  const a = (await createJob(user._id, { company: 'Bulk Alpha', position: 'Engineer' })).job;
  const b = (await createJob(user._id, { company: 'Bulk Beta', position: 'Designer' })).job;
  const navigate = async (path) => { await send('Page.navigate', { url: `${base}${path}` }); await wait(`!!document.querySelector('section[aria-label="Bulk actions"]')`, 'bulk toolbar'); };
  const choose = async (label) => {
    const selector = `input[aria-label=${JSON.stringify(`Select ${label}`)}]`;
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`, label);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const apply = async (action, success, failed = 0) => {
    await fill('select[aria-label="Bulk action"]', action);
    await click('Apply to selected');
    await wait(`document.querySelector('[role=status]')?.textContent.includes(${JSON.stringify(`${success} succeeded · ${failed} failed`)})`, 'bulk results');
  };
  const archiveToggle = () => evaluate(`[...document.querySelectorAll('label')].find(n=>n.textContent.includes('Show archived applications')).querySelector('input').click()`);
  await navigate('/dashboard/jobs'); await choose('Bulk Alpha'); await choose('Bulk Beta');
  await apply('offer', 2);
  for (const job of [a, b]) {
    assert.equal((await Job.findById(job._id)).status, 'offer');
    assert.equal(await StatusHistory.countDocuments({ jobId: job._id }), 2);
  }
  await choose('Bulk Alpha'); await apply('archive', 1);
  await wait(`!document.querySelector('input[aria-label="Select Bulk Alpha"]')`, 'archived card hidden');
  await navigate('/dashboard/jobs');
  assert.equal(await evaluate(`!!document.querySelector('input[aria-label="Select Bulk Alpha"]')`), false);
  await archiveToggle(); await choose('Bulk Alpha'); await apply('restore', 1);
  assert.equal((await Job.findById(a._id)).archivedAt, null);
  await archiveToggle(); await wait(`!!document.querySelector('input[aria-label="Select Bulk Alpha"]')`, 'restored card');

  await PendingItem.init();
  const common = { userId: user._id, accountId: new mongoose.Types.ObjectId(), provider: 'gmail', company: 'Bulk Alpha', position: 'Engineer', eventType: 'interview', receivedAt: new Date(), from: 'recruiter@example.test' };
  const good = await PendingItem.create({ ...common, messageId: 'bulk-ui-good', subject: 'Bulk valid invitation', targetJobId: a._id });
  const unresolved = await PendingItem.create({ ...common, messageId: 'bulk-ui-unresolved', subject: 'Bulk unresolved invitation' });
  await navigate('/dashboard/pending'); await choose(good.subject); await choose(unresolved.subject);
  await apply('accept', 1, 1);
  assert.equal((await PendingItem.findById(good._id)).status, 'accepted');
  assert.equal((await PendingItem.findById(unresolved._id)).status, 'pending');
  await wait(`document.querySelector('input[aria-label="Select Bulk unresolved invitation"]')?.checked`, 'failed item remains selected');
  await apply('ignore', 1);
  assert.equal((await PendingItem.findById(unresolved._id)).status, 'ignored');
  assert.equal(await StatusHistory.countDocuments({ 'source.messageId': 'bulk-ui-good' }), 1);
  assert.equal(await StatusHistory.countDocuments({ 'source.messageId': 'bulk-ui-unresolved' }), 0);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const path = join(tmpdir(), 'jobgenie-bulk-mobile.png');
  await writeFile(path, Buffer.from(shot.data, 'base64'));
  console.log(`PASS: bulk status/history, archive/restore persistence, per-email partial failure, retained selection, ignore and mobile layout. Screenshot: ${path}`);
}
