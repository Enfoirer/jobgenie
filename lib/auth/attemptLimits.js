import { consumeAuthLimit } from './rateLimit.js';
import { authError } from './validation.js';
import { clientIp } from './clientIp.js';

export const ATTEMPT_LIMITS = Object.freeze({
  login: { ip: 50, email: 10, windowMs: 15 * 60000 },
  register: { ip: 10, email: 3, windowMs: 60 * 60000 },
});
export async function checkAttemptLimit(action, dimension, value, { now = Date.now(), consume = consumeAuthLimit } = {}) {
  const policy = ATTEMPT_LIMITS[action];
  const allowed = await consume(`auth:${action}:${dimension}:${value}`, policy[dimension], policy.windowMs, now);
  if (!allowed) {
    const retryAfter = Math.max(1, Math.ceil((policy.windowMs - (now % policy.windowMs)) / 1000));
    throw Object.assign(authError(`Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`, 429), { retryAfter });
  }
}
export const checkIpAttempts = (action, request, options) => checkAttemptLimit(action, 'ip', clientIp(request), options);
