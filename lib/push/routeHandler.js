import { timingSafeEqual } from 'node:crypto';
import { isSameOriginRequest } from '../auth/requestOrigin.js';
import { consumeAuthLimit } from '../auth/rateLimit.js';
import { authError } from '../auth/validation.js';
import { apnsConfig } from './apns.js';
import { deviceInput, registerDevice, revokeDevice } from './devices.js';
import { resolveNotification, runPushWorker } from './worker.js';

async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw authError('JSON required', 415);
  const reader = request.body?.getReader();
  if (!reader) throw authError('Invalid request');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw authError('Request too large', 413); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw authError('Invalid JSON'); }
  } finally { reader.releaseLock(); }
}
export function createPushHandler({ action, authenticate, connect, env = () => process.env, limit = consumeAuthLimit, worker = runPushWorker }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
    try {
      if (action === 'cron') {
        const secret = env().CRON_SECRET, supplied = request.headers.get('authorization');
        const expected = secret ? `Bearer ${secret}` : '';
        if (!secret || secret.length < 32 || !supplied || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw authError('Not authenticated', 401);
        if (!['GET', 'POST'].includes(request.method)) throw authError('Method not allowed', 405);
        const config = apnsConfig(env());
        if (!config) throw authError('System notifications are not configured.', 503);
        await connect();
        return Response.json(await worker({ config }), { headers });
      }
      const identity = action === 'revoke' ? null : await authenticate();
      if (action !== 'revoke' && !identity?.userId) throw authError('Not authenticated', 401);
      if (action === 'status') {
        if (request.method !== 'GET') throw authError('Method not allowed', 405);
        const config = apnsConfig(env());
        return Response.json({ available: !!config, environments: config?.environments || [] }, { headers });
      }
      if (request.method !== 'POST') throw authError('Method not allowed', 405);
      if (!isSameOriginRequest(request)) throw authError('Invalid origin', 403);
      const body = await readBody(request);
      const installation = deviceInput(body, action === 'register' ? ['installationKey', 'sequence', 'token', 'environment', 'locale']
        : action === 'resolve' ? ['installationKey', 'sequence', 'deliveryId'] : ['installationKey', 'sequence']);
      await connect();
      if (!await limit(`push:${action}:${identity?.userId || installation}`, 60, 60000)) throw authError('Too many requests', 429);
      const result = action === 'register' ? await registerDevice(identity, body, apnsConfig(env()))
        : action === 'resolve' ? await resolveNotification(identity, body) : await revokeDevice(body);
      return Response.json(result, { headers });
    } catch (error) {
      const status = [400, 401, 403, 404, 405, 409, 413, 415, 429, 503].includes(error.status) ? error.status : 503;
      // No device tokens, installation capabilities, user data or APNs keys in logs.
      return Response.json({ error: status === 503 ? 'System notifications are temporarily unavailable.' : error.message },
        { status, headers: { ...headers, ...(status === 429 && { 'Retry-After': '60' }) } });
    }
  };
}
