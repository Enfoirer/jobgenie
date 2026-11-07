import { feedbackAction, feedbackStatus } from './feedback.js';
import { isSameOriginRequest } from '../auth/requestOrigin.js';
import { consumeAuthLimit } from '../auth/rateLimit.js';
import { authError } from '../auth/validation.js';

export function createFeedbackHandler({ authenticate, connect, limit = consumeAuthLimit }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store' };
    try {
      const userId = await authenticate();
      if (!userId) throw authError('Not authenticated', 401);
      if (!['GET', 'POST'].includes(request.method)) throw authError('Method not allowed', 405);
      let data;
      if (request.method === 'POST') {
        if (!isSameOriginRequest(request)) throw authError('Invalid origin', 403);
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw authError('JSON required', 415);
        const reader = request.body?.getReader(); const chunks = []; let size = 0;
        if (!reader) throw authError('Invalid body');
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length;
            if (size > 12288) { await reader.cancel(); throw authError('Feedback is too large', 413); }
            chunks.push(Buffer.from(value));
          }
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw authError('Invalid JSON'); }
        } finally { reader.releaseLock(); }
      }
      await connect();
      if (request.method === 'POST' && !await limit(`feedback:${userId}`, 60, 60000)) throw authError('Too many feedback requests', 429);
      return Response.json(request.method === 'GET' ? await feedbackStatus(userId) : await feedbackAction(userId, data), { headers });
    } catch (error) {
      const status = [400, 401, 403, 404, 405, 409, 413, 415, 429].includes(error.status) ? error.status : 503;
      if (status === 429) headers['Retry-After'] = '60';
      // Never log comments, ratings, user IDs or the request payload on failure.
      return Response.json({ error: status === 503 ? 'Feedback is temporarily unavailable. Please try again.' : error.message }, { status, headers });
    }
  };
}
