import { createHash, randomBytes } from 'node:crypto';
import NativeOAuthAttempt from '../models/NativeOAuthAttempt.js';
import { oauthHash, OAUTH_TTL_SECONDS } from './state.js';
import { authorizationUrl, providerConfig, publicOrigin, exchangeMailbox } from './providers.js';
import { saveMailbox } from './routeHandler.js';
import { consumeAuthLimit } from '../auth/rateLimit.js';
import { authError } from '../auth/validation.js';
import { isSameOriginRequest } from '../auth/requestOrigin.js';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
export const nativeStatePattern = /^native_[A-Za-z0-9_-]{43}$/;
export const nativeChallenge = verifier => createHash('sha256').update(verifier).digest('base64url');

// The browser only delivers the provider code to the server. The initiating App
// must prove PKCE possession AND the same authenticated session before binding.
export function createNativeOAuthHandler({ provider, action, authenticate, connect, env = () => process.env, exchange = exchangeMailbox, save = saveMailbox }) {
  return async request => {
    try {
      if (!['google', 'outlook'].includes(provider)) throw authError('Invalid provider', 400);
      const origin = publicOrigin(env());
      if (action === 'callback') {
        const query = new URL(request.url).searchParams;
        const state = query.get('state');
        if (!nativeStatePattern.test(state || '') || ['state', 'code', 'error'].some(k => query.getAll(k).length > 1)
            || (query.has('code') && query.has('error'))) throw authError('Invalid authorization callback', 400);
        const code = query.get('code');
        const status = query.has('error') ? (query.get('error') === 'access_denied' ? 'cancelled' : 'failed')
          : code && code.length <= 8192 ? 'ready' : 'failed';
        await connect();
        const accepted = await NativeOAuthAttempt.findOneAndUpdate({ _id: oauthHash(state), provider, status: 'awaiting', expiresAt: { $gt: new Date() } },
          { $set: { status, ...(status === 'ready' ? { code } : {}) } });
        if (!accepted) throw authError('Invalid or expired authorization', 400);
        return new Response(null, { status: 303, headers: { ...headers, Location: `com.enfoirer.jobgenie://oauth/mail?state=${encodeURIComponent(state)}` } });
      }
      const identity = await authenticate(request);
      if (!identity?.userId || !identity?.sessionId) throw authError('Sign in again', 401);
      if (!isSameOriginRequest(request, origin)) throw authError('Invalid origin', 403);
      let body;
      try { body = await request.json(); } catch { throw authError('Invalid request', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw authError('Invalid request', 400);
      await connect();
      if (action === 'start') {
        if (Object.keys(body).some(k => k !== 'challenge') || (typeof body.challenge !== 'string' || !secretPattern.test(body.challenge))) throw authError('Invalid challenge', 400);
        const config = providerConfig(provider, env());
        if (!await consumeAuthLimit(`native-oauth:${identity.userId}`, 10, 600000)) throw authError('Too many attempts', 429);
        const state = `native_${randomBytes(32).toString('base64url')}`;
        await NativeOAuthAttempt.create({ _id: oauthHash(state), userId: identity.userId, sessionHash: oauthHash(identity.sessionId),
          provider, challenge: body.challenge, status: 'awaiting', expiresAt: new Date(Date.now() + OAUTH_TTL_SECONDS * 1000) });
        return Response.json({ state, url: authorizationUrl(config, { state, challenge: body.challenge }) }, { headers });
      }
      if (!['finish', 'cancel'].includes(action) || Object.keys(body).some(k => !['state', 'verifier'].includes(k))
          || typeof body.state !== 'string' || !nativeStatePattern.test(body.state) || typeof body.verifier !== 'string' || !secretPattern.test(body.verifier)) throw authError('Invalid request', 400);
      const attempt = await NativeOAuthAttempt.findOneAndDelete({ _id: oauthHash(body.state), provider, userId: identity.userId,
        sessionHash: oauthHash(identity.sessionId), challenge: nativeChallenge(body.verifier), expiresAt: { $gt: new Date() },
        ...(action === 'finish' ? { status: { $ne: 'awaiting' } } : {}) }).select('+code');
      if (!attempt) throw authError('Invalid or expired authorization', 409);
      if (action === 'cancel') return Response.json({ outcome: 'cancelled' }, { headers });
      if (attempt.status !== 'ready') return Response.json({ outcome: attempt.status }, { headers });
      const mailbox = await exchange(providerConfig(provider, env()), attempt.code, body.verifier);
      const current = await authenticate(request);
      if (current?.userId !== identity.userId || current?.sessionId !== identity.sessionId) throw authError('Sign in again', 401);
      await save(identity.userId, mailbox);
      return Response.json({ outcome: 'connected' }, { headers });
    } catch (error) {
      const status = [400, 401, 403, 409, 429, 503].includes(error.status) ? error.status : 503;
      return Response.json({ error: status === 503 ? 'Mailbox connection is temporarily unavailable' : error.message },
        { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '600' } : {}) } });
    }
  };
}
