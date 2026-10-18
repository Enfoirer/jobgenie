import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import UploadedFile from '../lib/models/UploadedFile.js';
import { pdf, docx } from '../tests/fixtures/uploads.mjs';
import { MAX_UPLOAD_BYTES } from '../lib/uploads/policy.js';

export async function verifyUploads({ user, foreign, send, evaluate, wait, click, dialogCount, escape, base }) {
  const directory = await mkdtemp(join(tmpdir(), 'jobgenie-upload-ui-'));
  const downloads = join(directory, 'downloads'); await mkdir(downloads);
  try {
    await UploadedFile.init();
    const legacy = await UploadedFile.create({ userId: user._id, name: 'legacy.html', type: 'text/html', size: '1 KB', fileData: Buffer.from('<script>window.uploadExecuted=true</script>') });
    const hidden = await UploadedFile.create({ userId: foreign._id, name: 'private-owner.pdf', type: 'application/pdf', fileData: pdf });
    const choose = async (name, data) => {
      const path = join(directory, name); await writeFile(path, data);
      const { root } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
      await send('DOM.setFileInputFiles', { nodeId, files: [path] });
    };
    const downloaded = async (name, expected) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const data = await readFile(join(downloads, name)).catch(() => null);
        if (data) { assert.deepEqual(data, expected); return; }
        await delay(100);
      }
      throw new Error(`Download did not finish: ${name}`);
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${base}/dashboard/upload` });
    await wait(`!!document.querySelector('[data-upload-id="${legacy._id}"]') && !document.querySelector('input[type=file]').disabled`, 'upload page ready');
    assert.equal(await evaluate(`document.querySelector('input[type=file]').accept`), '.pdf,.docx,.png,.jpg,.jpeg');
    assert.equal(await evaluate(`document.body.innerText.includes('private-owner.pdf')`), false);
    await choose('blocked.html', '<script>window.uploadExecuted=true</script>');
    await wait(`document.querySelector('[role=alert]')?.textContent.includes('Only PDF')`, 'client allowlist');
    await choose('oversized.pdf', Buffer.alloc(MAX_UPLOAD_BYTES + 1));
    await wait(`document.querySelector('[role=alert]')?.textContent.includes('maximum 4 MB')`, 'client byte limit');
    await choose('disguised.pdf', '<html><script>window.uploadExecuted=true</script></html>');
    await wait(`document.querySelector('[role=alert]')?.textContent.includes('contents do not match')`, 'server content rejection surfaced');
    assert.equal(await UploadedFile.countDocuments({ userId: user._id }), 1);
    await choose('简历 2026.pdf', pdf);
    await wait(`document.body.innerText.includes('简历 2026.pdf') && !document.querySelector('input[type=file]').disabled`, 'valid PDF upload');
    await choose('resume.docx', docx);
    await wait(`document.body.innerText.includes('resume.docx') && !document.querySelector('input[type=file]').disabled`, 'valid DOCX upload');
    const saved = await UploadedFile.findOne({ userId: user._id, name: '简历 2026.pdf' });
    const row = `document.querySelector('[data-upload-id="${saved._id}"]')`;
    await click('Details', row); await dialogCount(1);
    assert.equal(await evaluate(`document.querySelector('dialog').querySelectorAll('iframe,object,embed,img').length`), 0);
    await escape(); await dialogCount(0);
    console.log('PASS: upload allowlist/size feedback, server rejection of disguised HTML, valid PDF/DOCX uploads and metadata-only details.');

    const headers = await evaluate(`fetch('/api/uploads/download/${saved._id}').then(r=>({status:r.status,type:r.headers.get('Content-Type'),disposition:r.headers.get('Content-Disposition'),sniff:r.headers.get('X-Content-Type-Options'),cache:r.headers.get('Cache-Control')}))`);
    assert.equal(headers.status, 200); assert.equal(headers.type, 'application/octet-stream');
    assert.match(headers.disposition, /^attachment;/); assert.equal(headers.sniff, 'nosniff'); assert.match(headers.cache, /no-store/);
    for (const path of [`/api/uploads/download/${hidden._id}`, '/api/uploads/download/not-an-id']) assert.equal(await evaluate(`fetch(${JSON.stringify(path)}).then(r=>r.status)`), 404);
    assert.equal(await evaluate(`fetch('/api/uploads/${hidden._id}',{method:'DELETE'}).then(r=>r.status)`), 404);
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await evaluate(`${row}.querySelector('a').click()`);
    await downloaded('简历 2026.pdf', pdf);
    const navigation = await send('Page.navigate', { url: `${base}/api/uploads/download/${legacy._id}` });
    assert.equal(navigation.isDownload, true);
    await downloaded('legacy.html', Buffer.from('<script>window.uploadExecuted=true</script>'));
    assert.equal(await evaluate('window.uploadExecuted === true'), false);
    assert.equal(await evaluate('location.pathname'), '/dashboard/upload');
    console.log('PASS: actual Chrome attachment downloads preserve Chinese names; direct navigation to legacy HTML downloads without executing in the app.');

    const timeOrigin = await evaluate('performance.timeOrigin'); await send('Page.reload');
    await wait(`performance.timeOrigin !== ${timeOrigin} && !!${row}`, 'files survive refresh');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate(`(() => { const box = ${row}.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })()`), true);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(tmpdir(), 'jobgenie-uploads-mobile.png'), Buffer.from(shot.data, 'base64'));
    await click('Delete', row); await wait(`!${row}`, 'owned file removed');
    assert.equal(await UploadedFile.countDocuments({ _id: saved._id }), 0);
    assert.equal(await evaluate(`fetch('/api/uploads/download/${saved._id}').then(r=>r.status)`), 404);
    assert.equal(await UploadedFile.countDocuments({ _id: hidden._id }), 1);
    console.log('PASS: owner isolation, bad IDs, reload persistence, deletion and 390px upload layout.');
  } finally {
    await send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
