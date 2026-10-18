import UploadedFile from '../models/UploadedFile.js';
import { isSameOriginRequest } from '../auth/requestOrigin.js';
import { MAX_REQUEST_BYTES, uploadError } from './policy.js';
import { validateUpload } from './validate.js';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const describe = (file) => ({ id: String(file._id), name: file.name, type: file.type || 'application/octet-stream',
  size: file.size, uploadDate: file.uploadDate, filePath: `/api/uploads/download/${file._id}` });

export function attachmentFilename(value) {
  const cleaned = typeof value === 'string' ? value.normalize('NFC').replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, '_').trim().slice(0, 180).replace(/[. ]+$/, '') : '';
  const name = cleaned && !/^\.+$/.test(cleaned) ? cleaned : 'download';
  // Encoding via UTF-8 handles malformed legacy strings without URIError.
  const encoded = Array.from(Buffer.from(name), (byte) => /[A-Za-z0-9!#$&+.^_`|~-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}

export async function readUploadBody(request) {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get('content-type') || '')) throw uploadError('Use a multipart file upload.', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) throw uploadError('Upload request too large (maximum file size 4 MB).', 413);
  if (!request.body) throw uploadError('Choose a file to upload.');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) { await reader.cancel(); throw uploadError('Upload request too large (maximum file size 4 MB).', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') } }).formData(); }
  catch { throw uploadError('Invalid upload request.'); }
  if (form.getAll('file').length !== 1 || [...form.keys()].some((key) => key !== 'file')) throw uploadError('Upload exactly one file at a time.');
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw uploadError('Choose a file to upload.');
  return file;
}

export function createUploadHandler({ authenticate, connect, action }) {
  return async function handler(request, context = {}) {
    try {
      const userId = await authenticate(request);
      if (!userId) throw uploadError('Not authenticated', 401);
      if (['create', 'delete'].includes(action) && !isSameOriginRequest(request)) throw uploadError('Invalid origin', 403);
      let id;
      if (['download', 'delete'].includes(action)) {
        id = (await context.params)?.id;
        if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw uploadError('File not found', 404);
      }
      if (action === 'create') {
        const { name, type, data } = await validateUpload(await readUploadBody(request));
        await connect();
        const file = await UploadedFile.create({ name, type, size: `${Math.ceil(data.length / 1024)} KB`, sizeBytes: data.length, fileData: data, userId });
        return Response.json({ success: true, file: describe(file) }, { status: 201, headers: privateHeaders });
      }
      await connect();
      if (action === 'list') {
        const files = await UploadedFile.find({ userId }).sort({ uploadDate: -1, _id: -1 }).lean();
        return Response.json({ files: files.map(describe) }, { headers: privateHeaders });
      }
      if (action === 'delete') {
        const result = await UploadedFile.deleteOne({ _id: id, userId });
        if (!result.deletedCount) throw uploadError('File not found', 404);
        return Response.json({ success: true }, { headers: privateHeaders });
      }
      const file = await UploadedFile.findOne({ _id: id, userId }).select('+fileData');
      if (!file || !file.fileData) throw uploadError('File not found', 404);
      return new Response(new Uint8Array(file.fileData), { headers: {
        ...privateHeaders, 'Content-Type': 'application/octet-stream',
        'Content-Disposition': attachmentFilename(file.name),
        'Content-Length': String(file.fileData.length),
        'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
        'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
      } });
    } catch (error) {
      const status = [400, 401, 403, 404, 413, 415].includes(error.status) ? error.status : 500;
      return Response.json({ error: status === 500 ? 'Unable to complete the file request. Please try again.' : error.message }, { status, headers: privateHeaders });
    }
  };
}
