import { authError, normalizeEmail } from '../auth/validation.js';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly openid email profile';
const OUTLOOK_SCOPE = 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access openid profile email';

export function publicOrigin(env = process.env) {
  try {
    const url = new URL(env.NEXTAUTH_URL || env.OAUTH_REDIRECT_BASE);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw authError('Mailbox connection is temporarily unavailable.', 503); }
}
export function providerConfig(provider, env = process.env) {
  const origin = publicOrigin(env);
  const google = provider === 'google';
  if (!google && provider !== 'outlook') throw authError('Unsupported provider.', 400);
  const tenant = env.OUTLOOK_TENANT_ID || 'common';
  if (!/^[a-z0-9.-]+$/i.test(tenant)) throw authError('Mailbox connection is temporarily unavailable.', 503);
  const clientId = google ? env.GOOGLE_CLIENT_ID : env.OUTLOOK_CLIENT_ID;
  const clientSecret = google ? env.GOOGLE_CLIENT_SECRET : env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw authError('Mailbox connection is temporarily unavailable.', 503);
  return { origin, clientId, clientSecret, provider, redirectUri: `${origin}/api/oauth/${provider}/callback`,
    scope: google ? GOOGLE_SCOPE : OUTLOOK_SCOPE,
    authorizationUrl: google ? 'https://accounts.google.com/o/oauth2/v2/auth' : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: google ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    profileUrl: google ? 'https://www.googleapis.com/gmail/v1/users/me/profile' : 'https://graph.microsoft.com/v1.0/me',
  };
}
export function authorizationUrl(config, attempt) {
  const url = new URL(config.authorizationUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: config.scope,
    state: attempt.state, code_challenge: attempt.challenge, code_challenge_method: 'S256',
    ...(config.provider === 'google' ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } : { response_mode: 'query', prompt: 'select_account' }),
  }).toString();
  return url.toString();
}
export async function exchangeMailbox(config, code, verifier, fetchImpl = fetch) {
  const params = new URLSearchParams({
    client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier,
    grant_type: 'authorization_code', redirect_uri: config.redirectUri,
    ...(config.provider === 'outlook' ? { scope: config.scope } : {}),
  });
  const tokenResponse = await fetchImpl(config.tokenUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  if (!tokenResponse.ok) throw new Error('Mailbox token exchange failed');
  const tokens = await tokenResponse.json();
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 32768 ||
      (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || tokens.refresh_token.length > 32768))) throw new Error('Invalid mailbox tokens');
  if (tokens.scope !== undefined) {
    if (typeof tokens.scope !== 'string') throw new Error('Invalid mailbox scope');
    const scopes = tokens.scope.toLowerCase().split(/\s+/);
    if (config.provider === 'google' ? !scopes.includes('https://www.googleapis.com/auth/gmail.readonly')
      : !scopes.some((scope) => scope === 'mail.read' || scope === 'https://graph.microsoft.com/mail.read')) throw new Error('Required mailbox permission was not granted');
  }
  const profileResponse = await fetchImpl(config.profileUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!profileResponse.ok) throw new Error('Mailbox profile lookup failed');
  const profile = await profileResponse.json();
  const emailAddress = normalizeEmail(config.provider === 'google' ? profile.emailAddress : profile.mail || profile.userPrincipalName || profile.preferred_username);
  const seconds = Number(tokens.expires_in);
  if (tokens.expires_in !== undefined && (!Number.isFinite(seconds) || seconds <= 0 || seconds > 365 * 86400)) throw new Error('Invalid mailbox token lifetime');
  return {
    provider: config.provider === 'google' ? 'gmail' : 'outlook', emailAddress,
    accessToken: tokens.access_token, ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(tokens.expires_in !== undefined ? { expiresAt: new Date(Date.now() + seconds * 1000) } : {}),
  };
}
