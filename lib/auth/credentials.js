import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { normalizeEmail } from './validation.js';
import { checkIpAttempts, checkAttemptLimit } from './attemptLimits.js';

// A valid fixed bcrypt hash keeps missing accounts on the password-check path.
const DUMMY_HASH = '$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
export function createCredentialsAuthorizer({ connect, findUser = (email) => User.findOne({ email }), compare = bcrypt.compare, checkIp = checkIpAttempts, checkEmail = checkAttemptLimit }) {
  return async (credentials, request) => {
    try {
      await connect();
      await checkIp('login', request);
      let email;
      try { email = normalizeEmail(credentials?.email); } catch { return null; }
      await checkEmail('login', 'email', email);
      if (typeof credentials?.password !== 'string' || !credentials.password || Buffer.byteLength(credentials.password, 'utf8') > 72) return null;
      const user = await findUser(email);
      const matches = await compare(credentials.password, user?.password || DUMMY_HASH);
      if (!user || !matches) return null;
      return { id: String(user._id), email: user.email, name: user.name || 'User', authVersion: user.authVersion || 0, rememberMe: credentials.rememberMe === 'true' };
    } catch (error) {
      // NextAuth v4 carries authorize errors in its redirect URL. Only fixed
      // codes leave this boundary; the route adapter restores HTTP status below.
      throw new Error(error.status === 429 ? `AUTH_RATE_LIMITED_${error.retryAfter}` : 'AUTH_UNAVAILABLE');
    }
  };
}

export async function credentialErrorResponse(response) {
  let target = response.headers.get('location');
  if (!target && response.headers.get('content-type')?.includes('application/json')) {
    target = (await response.clone().json().catch(() => null))?.url;
  }
  let code;
  try { code = new URL(target).searchParams.get('error'); } catch { return response; }
  const match = /^AUTH_RATE_LIMITED_(\d{1,4})$/.exec(code || '');
  if (!match && code !== 'AUTH_UNAVAILABLE') return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  if (match) headers.set('Retry-After', match[1]);
  return new Response(response.body, { status: match ? 429 : 503, headers });
}
