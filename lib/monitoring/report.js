import { isSameOriginRequest } from '../auth/requestOrigin.js';
import { consumeAuthLimit } from '../auth/rateLimit.js';
import { authError } from '../auth/validation.js';
import { KINDS } from './policy.js';
import { recordIncident } from './server.js';
export function createReportHandler({ authenticate, connect, limit = consumeAuthLimit, report = recordIncident }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store' };
    try {
      const userId = await authenticate();
      if (!userId) throw authError('Not authenticated', 401);
      if (!isSameOriginRequest(request)) throw authError('Invalid origin', 403);
      if (request.method !== 'POST' || !request.headers.get('content-type')?.startsWith('application/json')) throw authError('JSON POST required', 415);
      const reader = request.body?.getReader(); let size = 0; const chunks = [];
      if (!reader) throw authError('Invalid report');
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
          if (size > 2048) { await reader.cancel(); throw authError('Report too large', 413); } chunks.push(Buffer.from(value)); }
      } finally { reader.releaseLock(); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw authError('Invalid report'); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['platform', 'kind', 'route', 'method', 'status', 'version', 'digest'].includes(key))
        || !['web', 'ios'].includes(body.platform) || !KINDS.includes(body.kind)) throw authError('Invalid report fields');
      await connect();
      if (!await limit(`error-report:${userId}`, 30, 60000)) throw authError('Too many reports', 429);
      return Response.json(await report(body, { actor: String(userId), connect }), { headers });
    } catch (error) {
      const status = [400, 401, 403, 413, 415, 429].includes(error.status) ? error.status : 503;
      return Response.json({ error: status === 503 ? 'Error reporting unavailable.' : error.message }, { status, headers });
    }
  };
}
