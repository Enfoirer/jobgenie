import { createHash, randomBytes } from 'node:crypto';
import OAuthAttempt from '../models/OAuthAttempt.js';
import { authError } from '../auth/validation.js';

export const OAUTH_TTL_SECONDS = 600;
export const oauthHash = (value) => createHash('sha256').update(value).digest('hex');
const attemptId = ({ userId, sessionId }, provider) => oauthHash(`${userId}:${sessionId}:${provider}`);

export function stateCookieName(provider, origin) {
  return `${new URL(origin).protocol === 'https:' ? '__Host-' : ''}jobgenie-oauth-${provider}`;
}
export function stateCookie(provider, origin, value, clear = false) {
  return `${stateCookieName(provider, origin)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : OAUTH_TTL_SECONDS}${new URL(origin).protocol === 'https:' ? '; Secure' : ''}`;
}
export function readStateCookie(request, provider, origin) {
  const name = stateCookieName(provider, origin);
  const matches = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

export async function issueOAuthAttempt(identity, provider, now = Date.now()) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  await OAuthAttempt.updateOne({ _id: attemptId(identity, provider) }, { $set: {
    userId: identity.userId, provider, sessionHash: oauthHash(identity.sessionId), stateHash: oauthHash(state),
    browserHash: oauthHash(verifier), expiresAt: new Date(now + OAUTH_TTL_SECONDS * 1000),
  } }, { upsert: true });
  return { state, verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export async function consumeOAuthAttempt(identity, provider, state, verifier, now = Date.now()) {
  if (![state, verifier].every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value))) throw authError('Invalid authorization state.', 400);
  const consumed = await OAuthAttempt.findOneAndDelete({
    _id: attemptId(identity, provider), userId: identity.userId, provider,
    sessionHash: oauthHash(identity.sessionId), stateHash: oauthHash(state), browserHash: oauthHash(verifier), expiresAt: { $gt: new Date(now) },
  });
  if (!consumed) throw authError('Invalid authorization state.', 400);
}
