import Job from '../models/Job.js';
import UploadedFile from '../models/UploadedFile.js';
import JobDocument from '../models/JobDocument.js';
import { withUserMutation, jobError } from '../jobs/jobMutations.js';
import { validateUpload } from '../uploads/validate.js';

const kinds = ['resume', 'coverLetter', 'portfolio'];
function id(value) { if (!/^[a-f\d]{24}$/i.test(String(value))) jobError('Record not found', 404); }
async function owned(userId, jobId, session = null) {
  id(jobId);
  if (!await Job.exists({ _id: jobId, userId }).session(session)) jobError('Application not found', 404);
}
export function describe(document) {
  return { id: String(document._id), kind: document.kind, version: document.version, label: document.label,
    name: document.name, type: document.type, size: document.size, uploadDate: document.createdAt,
    sourceFileId: String(document.sourceFileId) };
}
export async function listDocuments(userId, jobId) {
  await owned(userId, jobId);
  const documents = await JobDocument.find({ userId, jobId }).sort({ kind: 1, version: -1 }).lean();
  return { documents: documents.map(describe) };
}
export async function linkDocument(userId, jobId, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['fileId', 'kind', 'label'].includes(k))
    || !kinds.includes(body.kind) || (body.label !== undefined && (typeof body.label !== 'string' || body.label.length > 200))) jobError('Invalid document fields');
  if (typeof body.fileId !== 'string') jobError('Invalid attachment ID');
  id(body.fileId);
  body = { ...body, fileId: body.fileId.toLowerCase() };
  return withUserMutation(userId, async session => {
    await owned(userId, jobId, session);
    const latest = await JobDocument.findOne({ userId, jobId, kind: body.kind }).sort({ version: -1 }).session(session);
    // Retry after an uncertain network result must not append the same revision.
    if (latest && String(latest.sourceFileId) === body.fileId && latest.label === (body.label || '').trim()) return { document: describe(latest) };
    if (await JobDocument.countDocuments({ userId, jobId }).session(session) >= 100) jobError('An application can retain up to 100 document versions', 409);
    const source = await UploadedFile.findOne({ _id: body.fileId, userId }).select('+fileData').session(session);
    if (!source?.fileData) jobError('Attachment not found', 404);
    const bytes = Buffer.from(source.fileData);
    const validated = await validateUpload({ name: source.name, type: source.type, size: bytes.length, arrayBuffer: async () => bytes });
    const [document] = await JobDocument.create([{ userId, jobId, sourceFileId: source._id, kind: body.kind,
      version: (latest?.version || 0) + 1, label: (body.label || '').trim(), name: validated.name, type: validated.type,
      size: `${Math.ceil(bytes.length / 1024)} KB`, sizeBytes: bytes.length, fileData: validated.data }], { session });
    return { document: describe(document) };
  });
}
export async function downloadDocument(userId, jobId, documentId) {
  await owned(userId, jobId); id(documentId);
  const document = await JobDocument.findOne({ _id: documentId, jobId, userId }).select('+fileData');
  if (!document?.fileData) jobError('Document not found', 404);
  return document;
}
