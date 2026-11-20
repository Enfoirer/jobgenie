import User from '../models/User.js';
import Job from '../models/Job.js';
import { isSameOriginRequest } from '../auth/requestOrigin.js';
import { authError } from '../auth/validation.js';
import { consumeAuthLimit } from '../auth/rateLimit.js';
import { noteFailure } from '../monitoring/server.js';

export function createOnboardingHandler({ authenticate, connect, limit = consumeAuthLimit }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store' };
    try {
      const userId = await authenticate();
      if (!userId) throw authError('Not authenticated', 401);
      if (!['GET', 'POST'].includes(request.method)) throw authError('Method not allowed', 405);
      let action;
      if (request.method === 'POST') {
        if (!isSameOriginRequest(request)) throw authError('Invalid origin', 403);
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw authError('JSON required', 415);
        const reader = request.body?.getReader();
        if (!reader) throw authError('Invalid body');
        const chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 512) { await reader.cancel(); throw authError('Request is too large', 413); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw authError('Invalid JSON'); }
        if (!data || Array.isArray(data) || Object.keys(data).length !== 1 || !['completed', 'skipped'].includes(data.action)) throw authError('Invalid guide choice');
        action = data.action;
      }
      await connect();
      if (request.method === 'POST') {
        if (!await limit(`onboarding:${userId}`, 30, 60000)) throw authError('Too many requests', 429);
        // First terminal choice wins, including concurrent retries from other tabs.
        await User.updateOne({ _id: userId, 'webOnboarding.outcome': { $exists: false } }, {
          $set: { webOnboarding: { outcome: action, finishedAt: new Date() } },
        });
      }
      const user = await User.findById(userId).select('webOnboarding').lean();
      if (!user) throw authError('Not authenticated', 401);
      const outcome = user.webOnboarding?.outcome || null;
      const eligible = !outcome && !await Job.exists({ userId });
      return Response.json({ eligible, outcome }, { headers });
    } catch (error) {
      noteFailure(error);
      const status = [400, 401, 403, 405, 413, 415, 429].includes(error.status) ? error.status : 503;
      if (status === 429) headers['Retry-After'] = '60';
      return Response.json({ error: status === 503 ? 'The guide is temporarily unavailable. Please try again.' : error.message }, { status, headers });
    }
  };
}
