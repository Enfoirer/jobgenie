import { clientIp } from './clientIp.js';
import { authError } from './validation.js';
import { consumeAuthLimit } from './rateLimit.js';
import { resetDeliveryConfig, sendPasswordReset } from './resetDelivery.js';
import { requestPasswordReset, resetPassword } from './passwordReset.js';
import { isSameOriginRequest } from './requestOrigin.js';

export function createResetHandler({ connect, action, config = resetDeliveryConfig, send = sendPasswordReset }) {
  return async (request) => {
    try {
      if (!isSameOriginRequest(request)) throw authError('Invalid origin', 403);
      let body;
      try { body = await request.json(); } catch { throw authError('Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw authError('Invalid request.');
      const delivery = action === 'request' ? config() : null;
      await connect();
      // Vercel supplies this trusted header. Other deployments must configure a
      // trusted proxy or share the conservative anonymous bucket.
      const ip = clientIp(request);
      if (!await consumeAuthLimit(`reset-ip:${action}:${ip}`, 20, 3600000)) throw authError('Too many requests. Please try again in an hour.', 429);
      const result = action === 'request'
        ? await requestPasswordReset(body.email, { origin: delivery.origin, send: (message) => send(message, delivery) })
        : await resetPassword(body.token, body.password);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const status = [400, 403, 429, 503].includes(error.status) ? error.status : 500;
      return Response.json({ error: status === 500 ? 'Unable to complete this request. Please try again later.' : error.message }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
