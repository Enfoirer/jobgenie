import { authError } from './validation.js';

export function resetDeliveryConfig(env = process.env) {
  let origin;
  try {
    const url = new URL(env.NEXTAUTH_URL);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error();
    origin = url.origin;
  } catch { throw authError('Password recovery is temporarily unavailable. Please try again later.', 503); }
  if (!env.RESEND_API_KEY || !env.PASSWORD_RESET_FROM) throw authError('Password recovery is temporarily unavailable. Please try again later.', 503);
  return { origin, apiKey: env.RESEND_API_KEY, from: env.PASSWORD_RESET_FROM };
}

export async function sendPasswordReset({ email, url }, config, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.from, to: [email], subject: 'Reset your JobGenie password',
      text: `Use this link to reset your JobGenie password:\n\n${url}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this email. Your password has not changed.`,
    }),
  });
  if (!response.ok) throw new Error('Reset delivery failed');
}
