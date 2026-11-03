import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../lib/models/User.js';
import Job from '../lib/models/Job.js';
import UploadedFile from '../lib/models/UploadedFile.js';
import JobDocument from '../lib/models/JobDocument.js';
import { linkDocument, listDocuments, downloadDocument } from '../lib/documents/documents.js';
import { createDocumentHandler } from '../lib/documents/routeHandler.js';
import { deleteJob } from '../lib/jobs/jobMutations.js';
import { pdf } from './fixtures/uploads.mjs';
let replica, user, other, job, file;
before(async () => {
 process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/jobgenie-mongodb-binaries';
 replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
 await mongoose.connect(replica.getUri()); await Promise.all([User, Job, UploadedFile, JobDocument].map(m => m.init()));
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => {
 await Promise.all([User, Job, UploadedFile, JobDocument].map(m => m.deleteMany({})));
 user = await User.create({ email: 'docs@example.test', password: 'test' });
 other = await User.create({ email: 'other@example.test', password: 'test' });
 job = await Job.create({ userId: user._id, company: 'Acme', position: 'Engineer' });
 file = await UploadedFile.create({ userId: user._id, name: 'resume.pdf', type: 'application/pdf', fileData: pdf });
});
const link = (kind = 'resume', fileId = String(file._id), label = '') => linkDocument(user._id, job._id, { kind, fileId, label });
test('snapshots survive library deletion and retain exact bytes and metadata across versions', async () => {
 const first = (await link()).document;
 const secondFile = await UploadedFile.create({ userId: user._id, name: 'resume-new.pdf', type: 'application/pdf', fileData: pdf });
 const second = (await link('resume', String(secondFile._id), 'Submitted revision')).document;
 assert.equal(first.version, 1); assert.equal(second.version, 2);
 await UploadedFile.deleteMany({ userId: user._id });
 assert.deepEqual(Buffer.from((await downloadDocument(user._id, job._id, first.id)).fileData), pdf);
 assert.equal((await downloadDocument(user._id, job._id, second.id)).name, 'resume-new.pdf');
 const list = (await listDocuments(user._id, job._id)).documents;
 assert.equal(list.length, 2); assert.equal(list[0].version, 2); assert(!('fileData' in list[0]));
});
test('concurrent repeat linking is idempotent and categories have independent versions', async () => {
 const results = await Promise.all([link(), link(), link()]);
 assert.equal(new Set(results.map(r => r.document.id)).size, 1);
 assert.equal((await link('resume', String(file._id).toUpperCase())).document.id, results[0].document.id);
 assert.equal((await link('coverLetter')).document.version, 1);
 assert.equal((await link('portfolio')).document.version, 1);
 assert.equal(await JobDocument.countDocuments(), 3);
});
test('foreign applications, source files and snapshot downloads cannot be accessed', async () => {
 const document = (await link()).document;
 await assert.rejects(listDocuments(other._id, job._id), { status: 404 });
 await assert.rejects(downloadDocument(other._id, job._id, document.id), { status: 404 });
 const foreignJob = await Job.create({ userId: other._id, company: 'Other', position: 'Role' });
 await assert.rejects(linkDocument(other._id, foreignJob._id, { fileId: String(file._id), kind: 'resume' }), { status: 404 });
 await assert.rejects(downloadDocument(other._id, foreignJob._id, document.id), { status: 404 });
 assert.equal(await JobDocument.countDocuments(), 1);
});
test('rejects protected fields, malformed input and legacy unsafe files without creating revisions', async () => {
 for (const body of [null, [], { kind: 'other', fileId: String(file._id) }, { kind: 'resume', fileId: String(file._id), userId: String(other._id) }, { kind: 'resume', fileId: String(file._id), label: 'a'.repeat(201) }]) await assert.rejects(linkDocument(user._id, job._id, body), { status: 400 });
 await UploadedFile.updateOne({ _id: file._id }, { fileData: Buffer.from('<html>bad</html>') });
 await assert.rejects(link(), { status: 415 });
 assert.equal(await JobDocument.countDocuments(), 0);
});
test('routes enforce authentication and origin and deliver snapshots as private attachments', async () => {
 let connects = 0;
 const anon = createDocumentHandler({ action: 'list', authenticate: async () => null, connect: async () => connects++ });
 assert.equal((await anon(new Request('https://example.test'))).status, 401); assert.equal(connects, 0);
 const make = action => createDocumentHandler({ action, authenticate: async () => user._id, connect: async () => {} });
 assert.equal((await make('link')(new Request('https://example.test/api', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' }), { params: { id: job._id } })).status, 403);
 const document = (await link()).document;
 const response = await make('download')(new Request('https://example.test/api'), { params: { id: job._id, documentId: document.id } });
 assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/octet-stream');
 assert.match(response.headers.get('content-disposition'), /^attachment;/); assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
});

test('deleting an application also deletes its private snapshots while retaining library files', async () => {
 await link(); await link('coverLetter');
 await deleteJob(user._id, job._id);
 assert.equal(await JobDocument.countDocuments({ jobId: job._id }), 0);
 assert.equal(await UploadedFile.countDocuments({ _id: file._id }), 1);
 await assert.rejects(listDocuments(user._id, job._id), { status: 404 });
});
