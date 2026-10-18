import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { authError, normalizeEmail, validateNewPassword } from './validation.js';
import { consumeAuthLimit } from './rateLimit.js';

export const RESET_MESSAGE = 'If an account matches this address, we will attempt to send a reset link. Check your inbox and spam folder. You can request another link after one minute.';
export const resetTokenHash = (token) => createHash('sha256').update(token).digest('hex');
const invalidLink = () => authError('This reset link is invalid or expired. Request a new link.');

export async function requestPasswordReset(emailInput, { origin, send, now = Date.now() }) {
  const email = normalizeEmail(emailInput);
  const allowed = await consumeAuthLimit(`reset-email:${email}`, 5, 3600000, now);
  const minuteAllowed = await consumeAuthLimit(`reset-minute:${email}`, 1, 60000, now);
  // The same response and rate-limit behavior applies to unknown addresses.
  if (!allowed || !minuteAllowed) return { message: RESET_MESSAGE };
  const secret = randomBytes(32).toString('hex');
  const user = await User.findOneAndUpdate({ email, $or: [
    { passwordResetRequestedAt: { $exists: false } },
    { passwordResetRequestedAt: { $lte: new Date(now - 60000) } },
  ] }, { $set: {
    passwordResetHash: resetTokenHash(secret), passwordResetExpiresAt: new Date(now + 30 * 60000), passwordResetRequestedAt: new Date(now),
  } }, { new: true });
  if (user) {
    const token = `${user._id}.${secret}`;
    const url = new URL('/reset-password', origin);
    url.hash = new URLSearchParams({ token }).toString();
    try { await send({ email: user.email, url: url.toString() }); }
    catch {
      await User.updateOne({ _id: user._id, passwordResetHash: resetTokenHash(secret) }, { $unset: { passwordResetHash: 1, passwordResetExpiresAt: 1 } });
      // Do not expose account existence, provider responses or reset tokens.
      console.error('Password reset delivery failed. Check the mail service configuration.');
    }
  }
  return { message: RESET_MESSAGE };
}

export async function resetPassword(token, password, { now = Date.now() } = {}) {
  validateNewPassword(password);
  if (typeof token !== 'string' || !/^[a-f0-9]{24}\.[a-f0-9]{64}$/.test(token)) throw invalidLink();
  const [id, secret] = token.split('.');
  const query = { _id: id, passwordResetHash: resetTokenHash(secret), passwordResetExpiresAt: { $gt: new Date(now) } };
  if (!await User.exists(query)) throw invalidLink();
  const hashed = await bcrypt.hash(password, 12);
  // One atomic claim: concurrent submissions cannot both change the password.
  const user = await User.findOneAndUpdate({ ...query, passwordResetExpiresAt: { $gt: new Date(Math.max(now, Date.now())) } }, {
    $set: { password: hashed }, $inc: { authVersion: 1 },
    $unset: { passwordResetHash: 1, passwordResetExpiresAt: 1 },
  });
  if (!user) throw invalidLink();
  return { message: 'Password updated. Sign in with your new password. All previous sessions have been signed out.' };
}
