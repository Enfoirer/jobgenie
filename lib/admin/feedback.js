import User from '../models/User.js';
import ProductFeedback from '../models/ProductFeedback.js';
import { authError } from '../auth/validation.js';

export async function requireAdmin(userId) {
  if (!userId) throw authError('Not authenticated', 401);
  if (!await User.exists({ _id: userId, role: 'admin' })) throw authError('Administrator access required', 403);
}

function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw authError('Use a valid calendar date');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw authError('Use a valid calendar date');
  return date;
}

export function feedbackQuery(params) {
  const allowed = ['platform', 'version', 'missingVersion', 'source', 'start', 'end', 'cursor'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw authError('Invalid feedback filter');
  }
  const conditions = [];
  const platform = params.get('platform');
  if (platform) {
    if (!['ios', 'web', 'unknown'].includes(platform)) throw authError('Invalid platform');
    conditions.push(platform === 'unknown' ? { platform: { $nin: ['ios', 'web'] } } : { platform });
  }
  const version = params.get('version');
  if (version) {
    if (!/^[a-zA-Z0-9._+-]{1,40}$/.test(version)) throw authError('Invalid version');
    conditions.push({ appVersion: version });
  }
  if (params.has('missingVersion')) {
    if (params.get('missingVersion') !== '1' || version) throw authError('Invalid version filter');
    conditions.push({ appVersion: { $in: [null, ''] } });
  }
  const source = params.get('source');
  if (source) {
    if (!['manual', 'prompt'].includes(source)) throw authError('Invalid response source');
    conditions.push({ source });
  }
  const start = params.get('start') ? calendarDate(params.get('start')) : null;
  const end = params.get('end') ? calendarDate(params.get('end')) : null;
  if (start && end && start > end) throw authError('Start date must be before the end date');
  if (start || end) conditions.push({ createdAt: { ...(start && { $gte: start }), ...(end && { $lt: new Date(end.getTime() + 86400000) }) } });
  const filter = conditions.length ? { $and: conditions } : {};
  let cursor;
  if (params.has('cursor')) {
    try {
      const raw = params.get('cursor');
      if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      cursor = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (Object.keys(cursor).sort().join(',') !== 'at,id' || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 200
        || typeof cursor.at !== 'string' || new Date(cursor.at).toISOString() !== cursor.at) throw new Error();
    } catch { throw authError('Invalid page cursor'); }
  }
  const pageFilter = cursor ? { $and: [filter, { $or: [{ createdAt: { $lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), _id: { $lt: cursor.id } }] }] } : filter;
  return { filter, pageFilter };
}

export async function listFeedback(params) {
  const { filter, pageFilter } = feedbackQuery(params);
  const [rows, total] = await Promise.all([
    ProductFeedback.find(pageFilter).select('overall recommendation comment source appVersion platform locale createdAt campaign').sort({ createdAt: -1, _id: -1 }).limit(26).lean(),
    ProductFeedback.countDocuments(filter),
  ]);
  const selected = rows.slice(0, 25);
  const last = selected.at(-1);
  return {
    total,
    items: selected.map(row => ({
      overall: row.overall, recommendation: row.recommendation, comment: row.comment || '',
      source: ['manual', 'prompt'].includes(row.source) ? row.source : 'unknown',
      appVersion: row.appVersion || 'Unknown', platform: ['ios', 'web'].includes(row.platform) ? row.platform : 'unknown',
      locale: row.locale || 'Unknown', campaign: row.campaign, createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > 25 ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last._id })).toString('base64url') : null,
  };
}

export function createAdminFeedbackHandler({ authenticate, connect, accessOnly = false }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
    try {
      const userId = await authenticate();
      if (!userId) throw authError('Not authenticated', 401);
      await connect();
      await requireAdmin(userId);
      if (request.method !== 'GET') throw authError('Method not allowed', 405);
      return Response.json(accessOnly ? { admin: true } : await listFeedback(new URL(request.url).searchParams), { headers });
    } catch (error) {
      const status = [400, 401, 403, 405].includes(error.status) ? error.status : 503;
      return Response.json({ error: status === 503 ? 'Feedback review is temporarily unavailable.' : error.message }, { status, headers });
    }
  };
}
