import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { authError, normalizeEmail, validateNewPassword } from './validation.js';
import { isSameOriginRequest } from './requestOrigin.js';
import { checkIpAttempts, checkAttemptLimit } from './attemptLimits.js';

async function readRegistration(request) {
  const reader = request.body?.getReader();
  if (!reader) throw authError('Invalid request.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw authError('Request too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw authError('Invalid request.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['name', 'email', 'password'].includes(key))) throw authError('Invalid request.');
  return body;
}

export function createRegisterHandler({ connect, checkIp = checkIpAttempts, checkEmail = checkAttemptLimit }) {
  return async (request) => {
    try {
      if (!isSameOriginRequest(request)) throw authError('Invalid origin', 403);
      await connect();
      await checkIp('register', request);
      const body = await readRegistration(request);
      const email = normalizeEmail(body.email);
      await checkEmail('register', 'email', email);
      validateNewPassword(body.password);
      if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length > 100)) throw authError('Name must be at most 100 characters.');
      if (await User.exists({ email })) throw authError('Unable to create an account with these details. Try signing in or resetting your password.', 409);
      const password = await bcrypt.hash(body.password, 12);
      const user = await User.create({ name: body.name?.trim() || 'New User', email, password });
      return Response.json({ user: { id: String(user._id), name: user.name, email: user.email } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const status = error.code === 11000 ? 409 : [400, 403, 409, 413, 429].includes(error.status) ? error.status : 503;
      const message = status === 503 ? 'Registration is temporarily unavailable. Please try again later.'
        : status === 409 ? 'Unable to create an account with these details. Try signing in or resetting your password.' : error.message;
      return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': String(error.retryAfter) } : {}) } });
    }
  };
}
