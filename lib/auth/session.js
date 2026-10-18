export const SHORT_SESSION_SECONDS = 12 * 60 * 60;
export const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;

export function startAuthToken(token, user, now = Date.now()) {
  return { ...token, id: user.id, authVersion: user.authVersion || 0,
    authExpiresAt: Math.floor(now / 1000) + (user.rememberMe ? REMEMBERED_SESSION_SECONDS : SHORT_SESSION_SECONDS) };
}

export function validAuthToken(token, user, now = Date.now()) {
  const expires = token.authExpiresAt ?? token.exp; // Existing sessions keep their original expiry.
  return !!user && typeof expires === 'number' && expires > Math.floor(now / 1000) &&
    (token.authVersion || 0) === (user.authVersion || 0);
}
