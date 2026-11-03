import assert from 'node:assert/strict';
import UploadedFile from '../lib/models/UploadedFile.js';
import JobDocument from '../lib/models/JobDocument.js';
export async function verifyDocuments({ user, job, send, evaluate, wait, click, fill, base }) {
  await JobDocument.init();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
  const file = await UploadedFile.create({ userId: user._id, name: 'resume.pdf', type: 'application/pdf', size: '1 KB', fileData: pdf });
  const open = async () => {
    await wait(`!!document.querySelector('[data-rfd-draggable-id="${job._id}"]')`, 'job card');
    await evaluate(`document.querySelector('[data-rfd-draggable-id="${job._id}"]').click()`);
    await wait('!!document.querySelector("select[aria-label=\\"Library file\\"] option[value=\\"'+file._id+'\\"]")', 'attachment picker');
  };
  await open();
  await fill('select[aria-label="Library file"]', String(file._id));
  await fill('input[aria-label="Version note"]', 'First submission'); await click('Save document version');
  await wait('document.querySelector("section[aria-label=\\"Application documents\\"]").textContent.includes("v1")', 'first revision');
  await fill('input[aria-label="Version note"]', 'Updated submission'); await click('Save document version');
  await wait('document.querySelector("section[aria-label=\\"Application documents\\"]").textContent.includes("v2")', 'second revision');
  await click('View', 'document.querySelector("section[aria-label=\\"Application documents\\"]")');
  await wait('document.querySelector("canvas[aria-label=\\"PDF document preview\\"]")?.width === 300 && !document.body.textContent.includes("Loading preview…")', 'safe PDF canvas');
  assert.equal(await evaluate('document.body.textContent.includes("Preview unavailable")'), false);
  await UploadedFile.deleteOne({ _id: file._id });
  const docs = await JobDocument.find({ jobId: job._id }).sort({ version: 1 }).select('+fileData');
  assert.equal(docs.length, 2); assert(docs[0].fileData.equals(pdf));
  const response = await evaluate(`fetch('/api/jobs/${job._id}/documents/${docs[0]._id}').then(async r => ({status:r.status, bytes:(await r.arrayBuffer()).byteLength, disposition:r.headers.get('content-disposition')}))`);
  assert.equal(response.status, 200); assert.equal(response.bytes, pdf.length); assert.match(response.disposition, /^attachment/);
  await send('Page.navigate', { url: `${base}/dashboard/jobs` });
  await wait(`!!document.querySelector('[data-rfd-draggable-id="${job._id}"]')`, 'reload jobs');
  await evaluate(`document.querySelector('[data-rfd-draggable-id="${job._id}"]').click()`);
  await wait('document.querySelector("section[aria-label=\\"Application documents\\"]")?.textContent.includes("v2")', 'versions survive reload');
  console.log('PASS: web link/version history, PDF canvas, exact snapshot after library deletion, reload persistence.');
}
