import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import PushDevice from '../models/PushDevice.js';
import User from '../models/User.js';
import { withUserMutation, jobError } from '../jobs/jobMutations.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function deviceInput(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))
    || !/^[a-f0-9]{64}$/.test(body.installationKey || '') || !Number.isSafeInteger(body.sequence) || body.sequence < 1) jobError('Invalid device request');
  return hash(body.installationKey);
}
export async function registerDevice(identity, body, config, now = Date.now()) {
  const id = deviceInput(body, ['installationKey', 'sequence', 'token', 'environment', 'locale']);
  if (!config) jobError('System notifications are not configured on the server.', 503);
  if (!config.environments.includes(body.environment) || !/^[a-f0-9]{64,512}$/.test(body.token || '') || body.token.length % 2
    || !['en', 'zh-Hans'].includes(body.locale)) jobError('Invalid push token, environment or language');
  const expiry = Date.parse(identity.expires);
  if (!identity.sessionId || !Number.isFinite(expiry) || expiry <= now || !mongoose.isValidObjectId(identity.userId)) jobError('Sign in again.', 401);
  return withUserMutation(identity.userId, async session => {
    const user = await User.findById(identity.userId).session(session).lean();
    if ((identity.authVersion || 0) !== (user.authVersion || 0)) jobError('Sign in again.', 401);
    const old = await PushDevice.findById(id).select('+token').session(session).lean();
    const tokenHash = hash(`${config.topic}:${body.environment}:${body.token}`);
    if (old && old.sequence >= body.sequence) {
      if (old.sequence === body.sequence && old.active && String(old.userId) === String(identity.userId)
        && old.sessionId === hash(identity.sessionId) && old.tokenHash === tokenHash && old.locale === body.locale) {
        return { bindingId: old.bindingId, enabled: true };
      }
      jobError('This device binding changed. Refresh notification settings.', 409);
    }
    if (await PushDevice.countDocuments({ userId: identity.userId, active: true, expiresAt: { $gt: new Date(now) }, _id: { $ne: id } }).session(session) >= 10) jobError('Too many registered devices.', 409);
    // A refreshed/reinstalled token must not remain active under another account.
    await PushDevice.updateMany({ tokenHash, active: true, _id: { $ne: id } }, { $set: { active: false, updatedAt: new Date(now) } }, { session });
    const bindingId = randomUUID();
    await PushDevice.findOneAndUpdate({ _id: id }, { $set: { sequence: body.sequence, userId: identity.userId,
      sessionId: hash(identity.sessionId), authVersion: user.authVersion || 0, expiresAt: new Date(expiry), bindingId,
      token: body.token, tokenHash, environment: body.environment, locale: body.locale, active: true, updatedAt: new Date(now) } }, { upsert: true, session });
    return { bindingId, enabled: true };
  });
}
// This capability can only disable this installation. It works after session
// expiry/offline logout; it never reads account data or authorizes registration.
export async function revokeDevice(body, now = Date.now()) {
  const id = deviceInput(body, ['installationKey', 'sequence']);
  try {
    await PushDevice.findOneAndUpdate({ _id: id, sequence: { $lte: body.sequence } },
      { $set: { sequence: body.sequence, active: false, updatedAt: new Date(now) },
        $unset: { token: '', tokenHash: '', userId: '', sessionId: '', bindingId: '', expiresAt: '', authVersion: '' } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; /* An older revoke cannot disable a newer binding. */ }
  return { enabled: false };
}
