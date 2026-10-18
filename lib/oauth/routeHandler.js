import MailAccount from '../models/MailAccount.js';
import { withUserMutation } from '../jobs/jobMutations.js';
import { consumeAuthLimit } from '../auth/rateLimit.js';
import { authError } from '../auth/validation.js';
import { isSameOriginRequest } from '../auth/requestOrigin.js';
import { providerConfig, authorizationUrl, exchangeMailbox, publicOrigin } from './providers.js';
import { issueOAuthAttempt, consumeOAuthAttempt, stateCookie, readStateCookie } from './state.js';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export async function saveMailbox(userId, mailbox) {
  // Serialize bindings for the same user, including separate browser sessions.
  // This avoids duplicate accounts without adding a unique index to legacy data.
  return withUserMutation(userId, async (session) => {
    const query = { userId, provider: mailbox.provider, emailAddress: mailbox.emailAddress };
    const existing = await MailAccount.findOne(query).session(session);
    if (existing) {
      await MailAccount.updateOne({ _id: existing._id, userId }, { $set: mailbox }, { session });
      return existing._id;
    }
    return (await MailAccount.create([{ ...query, ...mailbox }], { session }))[0]._id;
  });
}

export function createOAuthHandler({ action, provider, authenticate, connect, env = () => process.env, exchange = exchangeMailbox, save = saveMailbox }) {
  return async (request) => {
    let origin, consumed = false;
    try {
      origin = publicOrigin(env());
      const identity = await authenticate(request);
      if (!identity?.userId || !identity?.sessionId) throw authError('Sign in again before connecting your mailbox.', 401);
      if (action === 'start') {
        if (!isSameOriginRequest(request, origin)) throw authError('Invalid origin', 403);
        const config = providerConfig(provider, env());
        await connect();
        if (!await consumeAuthLimit(`oauth-start:${identity.userId}`, 10, 10 * 60000)) throw authError('Too many connection attempts. Please try again in 10 minutes.', 429);
        const attempt = await issueOAuthAttempt(identity, provider);
        return Response.json({ url: authorizationUrl(config, attempt) }, { headers: { ...headers, 'Set-Cookie': stateCookie(provider, origin, attempt.verifier) } });
      }
      const query = new URL(request.url).searchParams;
      if (['state', 'code', 'error'].some((key) => query.getAll(key).length > 1)) throw authError('Invalid authorization state.', 400);
      const verifier = readStateCookie(request, provider, origin);
      await connect();
      await consumeOAuthAttempt(identity, provider, query.get('state'), verifier);
      consumed = true;
      const redirect = (params) => new Response(null, { status: 303, headers: { ...headers,
        Location: `${origin}/dashboard/mail?${new URLSearchParams(params)}`, 'Set-Cookie': stateCookie(provider, origin, '', true),
      } });
      if (query.has('error')) return redirect({ oauth_error: query.get('error') === 'access_denied' ? 'cancelled' : 'failed' });
      const code = query.get('code');
      if (!code || code.length > 8192) return redirect({ oauth_error: 'failed' });
      const config = providerConfig(provider, env());
      const mailbox = await exchange(config, code, verifier);
      // Re-check session validity (including password resets) before persistence.
      const current = await authenticate(request);
      if (current?.userId !== identity.userId || current?.sessionId !== identity.sessionId) throw authError('Sign in again before connecting your mailbox.', 401);
      await save(identity.userId, mailbox);
      return redirect({ connected: mailbox.provider });
    } catch (error) {
      if (action === 'callback' && origin) {
        const reason = error.status === 401 ? 'session_expired' : error.status === 400 ? 'invalid_state' : 'failed';
        return new Response(null, { status: 303, headers: { ...headers, Location: `${origin}/dashboard/mail?oauth_error=${reason}`,
          ...(consumed ? { 'Set-Cookie': stateCookie(provider, origin, '', true) } : {}),
        } });
      }
      const status = [400, 401, 403, 429, 503].includes(error.status) ? error.status : 503;
      return Response.json({ error: status === 503 ? 'Mailbox connection is temporarily unavailable.' : error.message }, {
        status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '600' } : {}) },
      });
    }
  };
}
