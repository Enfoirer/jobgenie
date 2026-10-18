import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import UploadedFile from '../lib/models/UploadedFile.js';
import { validateUpload } from '../lib/uploads/validate.js';
import { MAX_UPLOAD_BYTES, MAX_REQUEST_BYTES, UPLOAD_TYPES, validateUploadMetadata } from '../lib/uploads/policy.js';
import { attachmentFilename, createUploadHandler, readUploadBody } from '../lib/uploads/routeHandler.js';
import { pdf, png, jpeg, docx, docxEntries, zip } from './fixtures/uploads.mjs';

const origin = 'https://jobgenie.example.test';
const owner = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
const file = (name = 'resume.pdf', data = pdf, type = 'application/pdf') => new File([data], name, { type });
const request = (upload = file(), headers = {}) => {
  const form = new FormData(); form.append('file', upload);
  return new Request(`${origin}/api/uploads`, { method: 'POST', body: form, headers });
};
const context = (id) => ({ params: Promise.resolve({ id: String(id) }) });
const handler = (action, userId = owner) => createUploadHandler({ action, authenticate: async () => userId, connect: async () => {} });
let replica;
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri()); await UploadedFile.init();
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => { await UploadedFile.deleteMany({}); });

for (const [name, data, type] of [['resume.pdf', pdf, UPLOAD_TYPES.pdf], ['resume.docx', docx, UPLOAD_TYPES.docx], ['image.png', png, UPLOAD_TYPES.png], ['image.jpg', jpeg, UPLOAD_TYPES.jpg], ['image.JPEG', jpeg, UPLOAD_TYPES.jpeg]]) {
  test(`accepts matching ${name} and stores a canonical MIME type`, async () => {
    const checked = await validateUpload(file(name, data, type));
    assert.equal(checked.type, type); assert.deepEqual(checked.data, data);
    const response = await handler('create')(request(file(name, data, type)));
    assert.equal(response.status, 201);
    const created = (await response.json()).file;
    assert.equal(created.name, name); assert.equal(created.type, type);
    assert.equal((await UploadedFile.findById(created.id)).fileData, undefined);
  });
}

test('rejects active formats, legacy DOC, macro formats and misleading extensions', async () => {
  for (const name of ['resume.html', 'image.svg', 'resume.doc', 'resume.docm', 'script.js', 'resume.pdf.html', 'archive.zip', 'resume', '.pdf', 'payload.exe']) {
    await assert.rejects(validateUpload(file(name)), (error) => [400, 415].includes(error.status));
  }
  assert.equal(await UploadedFile.countDocuments(), 0);
});

test('rejects HTML or SVG disguised as PDF/images and mismatched declared MIME', async () => {
  for (const name of ['resume.pdf', 'picture.png', 'picture.jpg', 'resume.docx']) {
    const type = UPLOAD_TYPES[name.split('.').at(-1)];
    await assert.rejects(validateUpload(file(name, Buffer.from('<html><script>alert(1)</script></html>'), type)), { status: 415 });
  }
  await assert.rejects(validateUpload(file('resume.pdf', pdf, 'text/html')), { status: 415 });
  await assert.rejects(validateUpload(file('photo.png', pdf, 'image/png')), { status: 415 });
  await assert.rejects(validateUpload(file('photo.jpg', jpeg.subarray(0, -2), 'image/jpeg')), { status: 415 });
  await assert.rejects(validateUpload(file('resume.pdf', pdf.subarray(0, -6))), { status: 415 });
});

test('empty/generic browser MIME requires the same content validation', async () => {
  for (const type of ['', 'application/octet-stream']) {
    assert.equal((await validateUpload(file('resume.PDF', pdf, type))).type, 'application/pdf');
    await assert.rejects(validateUpload(file('resume.pdf', Buffer.from('not a PDF'), type)), { status: 415 });
  }
});

test('bounds bytes and rejects invalid names before reading file content', async () => {
  for (const name of ['../resume.pdf', 'C:\\resume.pdf', 'resume.pdf\r\nX-Evil: yes', 'resume\u0000.pdf', 'evil\u202Efdp.exe.pdf', ' resume.pdf', 'resume.pdf ', 'a'.repeat(241) + '.pdf']) {
    assert.throws(() => validateUploadMetadata({ name, size: 100, type: 'application/pdf' }));
  }
  assert.throws(() => validateUploadMetadata({ name: 'resume.pdf', size: 0 }), { status: 400 });
  let reads = 0;
  await assert.rejects(validateUpload({ name: 'resume.pdf', size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf', arrayBuffer: async () => { reads++; } }), { status: 413 });
  assert.equal(reads, 0);
  assert.equal(validateUploadMetadata({ name: '简历 final.PDF', size: MAX_UPLOAD_BYTES }).type, 'application/pdf');
  await assert.rejects(validateUpload({ name: 'resume.pdf', size: pdf.length + 1, arrayBuffer: async () => pdf }), { status: 413 });
});

test('DOCX requires real Word package parts, not just a renamed ZIP', async () => {
  for (const buffer of [zip([['hello.txt', 'hello']]), zip(docxEntries.slice(0, 2)), Buffer.from('PK\x03\x04fake'), docx.subarray(0, -15), zip(docxEntries.map(([name, value]) => [name, name === '[Content_Types].xml' ? value.replace('wordprocessingml.document.main', 'spreadsheetml.sheet.main') : value]))]) {
    await assert.rejects(validateUpload(file('resume.docx', buffer, UPLOAD_TYPES.docx)), { status: 415 });
  }
  assert.equal((await validateUpload(file('resume.docx', zip(docxEntries, { compressed: false }), UPLOAD_TYPES.docx))).type, UPLOAD_TYPES.docx);
});

test('DOCX rejects macros, embedded objects, encrypted entries, duplicate and traversal paths', async () => {
  for (const entries of [
    [...docxEntries, ['word/vbaProject.bin', 'macro']], [...docxEntries, ['word/embeddings/object.bin', 'object']],
    [...docxEntries, ['../outside', 'bad']], [...docxEntries, docxEntries[0]],
    docxEntries.map(([name, value]) => [name, name === '[Content_Types].xml' ? value.replace('wordprocessingml.document.main', 'ms-word.document.macroEnabled.main') : value]),
    docxEntries.map(([name, value]) => [name, name === 'word/document.xml' ? '<!DOCTYPE document>' + value : value]),
  ]) await assert.rejects(validateUpload(file('resume.docx', zip(entries), UPLOAD_TYPES.docx)), { status: 415 });
  await assert.rejects(validateUpload(file('resume.docx', zip(docxEntries, { flags: 1 }), UPLOAD_TYPES.docx)), { status: 415 });
});

test('DOCX bounds decompression, entry count and false uncompressed lengths', async () => {
  for (const buffer of [
    zip(docxEntries, { claimedSize: 40 * 1024 * 1024 }), zip(docxEntries, { claimedSize: 1 }),
    zip([...docxEntries, ['word/big.xml', 'a'.repeat(17 * 1024 * 1024)]]),
    zip([...docxEntries, ...Array.from({ length: 513 }, (_, index) => [`extra/${index}`, ''])]),
  ]) await assert.rejects(validateUpload(file('resume.docx', buffer, UPLOAD_TYPES.docx)), { status: 415 });
});

test('multipart rejects text fields, repeated files, extra fields and malformed requests', async () => {
  for (const form of [new FormData(), (() => { const f = new FormData(); f.append('file', 'text'); return f; })(),
    (() => { const f = new FormData(); f.append('file', file()); f.append('file', file()); return f; })(),
    (() => { const f = new FormData(); f.append('file', file()); f.append('userId', String(other)); return f; })()]) {
    assert.equal((await handler('create')(new Request(`${origin}/api/uploads`, { method: 'POST', body: form }))).status, 400);
  }
  assert.equal((await handler('create')(new Request(`${origin}/api/uploads`, { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await handler('create')(new Request(`${origin}/api/uploads`, { method: 'POST', body: 'broken', headers: { 'Content-Type': 'multipart/form-data; boundary=abc' } }))).status, 400);
  assert.equal(await UploadedFile.countDocuments(), 0);
});

test('request limit checks actual streamed bytes even without Content-Length and cancels early', async () => {
  const headers = { 'Content-Type': 'multipart/form-data; boundary=abc' };
  await assert.rejects(readUploadBody(new Request(`${origin}/api/uploads`, { method: 'POST', headers: { ...headers, 'Content-Length': String(MAX_REQUEST_BYTES + 1) }, body: 'x' })), { status: 413 });
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(readUploadBody(new Request(`${origin}/api/uploads`, { method: 'POST', headers, body: stream, duplex: 'half' })), { status: 413 });
  assert.equal(cancelled, true);
});

test('all endpoints authenticate before connecting or consuming request content', async () => {
  for (const action of ['create', 'list', 'download', 'delete']) {
    let connects = 0;
    const route = createUploadHandler({ action, authenticate: async () => null, connect: async () => { connects++; } });
    assert.equal((await route(request(), context(new mongoose.Types.ObjectId()))).status, 401);
    assert.equal(connects, 0);
  }
});

test('upload and delete reject cross-origin writes', async () => {
  assert.equal((await handler('create')(request(file(), { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await handler('delete')(new Request(`${origin}/api/uploads/id`, { method: 'DELETE', headers: { origin: 'https://evil.test' } }), context(new mongoose.Types.ObjectId()))).status, 403);
});

test('only the owner can list, download or delete a file; bad and foreign IDs are indistinguishable', async () => {
  const own = await UploadedFile.create({ userId: owner, name: 'own.pdf', type: 'application/pdf', fileData: pdf });
  const hidden = await UploadedFile.create({ userId: other, name: 'private.pdf', fileData: pdf });
  const list = await (await handler('list')(new Request(`${origin}/api/uploads`))).json();
  assert.deepEqual(list.files.map((item) => item.id), [String(own._id)]);
  assert.equal(JSON.stringify(list).includes('fileData'), false);
  for (const action of ['download', 'delete']) {
    for (const id of ['bad', hidden._id, new mongoose.Types.ObjectId()]) assert.equal((await handler(action)(new Request(origin), context(id))).status, 404);
  }
  assert.equal((await handler('delete')(new Request(origin), context(own._id))).status, 200);
  assert.equal(await UploadedFile.countDocuments({ _id: hidden._id }), 1);
});

test('all downloads including legacy HTML/SVG use inert MIME, attachment and no-store/nosniff headers', async () => {
  for (const [name, type, content] of [['resume.pdf', 'application/pdf', pdf], ['old.html', 'text/html', Buffer.from('<script>window.injected=true</script>')], ['old.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>')]]) {
    const record = await UploadedFile.create({ userId: owner, name, type, fileData: content });
    const response = await handler('download')(new Request(origin), context(record._id));
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
  }
});

test('legacy filenames cannot inject headers and Unicode download names are preserved', async () => {
  assert.match(attachmentFilename('简历 2026.pdf'), /filename\*=UTF-8''%E7%AE%80%E5%8E%86%202026.pdf/);
  for (const name of ['bad"; inline\r\nX-Evil: yes.html', '../path\\bad.pdf', '\u202Efdp.exe', '\ud800.pdf', '', null]) {
    const header = attachmentFilename(name);
    assert.equal(/[\r\n]/.test(header), false);
    assert.ok(new Headers({ 'Content-Disposition': header }));
    assert.match(header, /^attachment; filename="download";/);
  }
});

test('invalid content is never saved and server exceptions do not disclose internals', async () => {
  const rejected = await handler('create')(request(file('resume.pdf', Buffer.from('<script>bad</script>'))));
  assert.equal(rejected.status, 415); assert.equal(await UploadedFile.countDocuments(), 0);
  const broken = createUploadHandler({ action: 'list', authenticate: async () => owner, connect: async () => { throw new Error('secret database URI'); } });
  const response = await broken(new Request(origin));
  assert.equal(response.status, 500); assert.equal((await response.text()).includes('secret'), false);
});
