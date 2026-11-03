import { isSameOriginRequest } from '../auth/requestOrigin.js';
import { readJobBody } from '../jobs/routeHandler.js';
import { attachmentFilename } from '../uploads/routeHandler.js';
import { listDocuments, linkDocument, downloadDocument } from './documents.js';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export function createDocumentHandler({ authenticate, connect, action }) {
  return async (request, context = {}) => {
    try {
      const userId = await authenticate();
      if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401, headers });
      if (action === 'link' && !isSameOriginRequest(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
      const params = await context.params;
      await connect();
      if (action === 'download') {
        const file = await downloadDocument(userId, params.id, params.documentId);
        return new Response(new Uint8Array(file.fileData), { headers: { ...headers,
          'Content-Type': 'application/octet-stream', 'Content-Disposition': attachmentFilename(file.name),
          'Content-Length': String(file.fileData.length), 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
          'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin' } });
      }
      const result = action === 'link' ? await linkDocument(userId, params.id, await readJobBody(request)) : await listDocuments(userId, params.id);
      return Response.json(result, { headers });
    } catch (error) {
      const status = error.status || 500;
      return Response.json({ error: status >= 500 ? 'Unable to load or save application documents.' : error.message }, { status, headers });
    }
  };
}
