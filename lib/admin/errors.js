import ErrorIncident from '../models/ErrorIncident.js';
import { requireAdmin, calendarDate } from './feedback.js';
import { referencePattern, safeVersion } from '../monitoring/policy.js';
import { authError } from '../auth/validation.js';
export function errorFilters(params) {
  for (const key of params.keys()) if (!['reference', 'platform', 'version', 'start', 'end', 'before'].includes(key) || params.getAll(key).length !== 1) throw authError('Invalid filter');
  const filter = { expiresAt: { $gt: new Date() } };
  const reference = params.get('reference');
  if (reference) { if (!referencePattern.test(reference)) throw authError('Invalid error reference'); filter._id = reference; }
  const platform = params.get('platform');
  if (platform) { if (!['server', 'web', 'ios'].includes(platform)) throw authError('Invalid platform'); filter.platform = platform; }
  const version = params.get('version');
  if (version) { if (safeVersion(version) !== version && version !== 'unknown') throw authError('Invalid version'); filter.version = version; }
  const start = params.get('start') ? calendarDate(params.get('start')) : null;
  const end = params.get('end') ? calendarDate(params.get('end')) : null;
  if (start && end && start > end) throw authError('Invalid date range');
  if (start || end) filter.createdAt = { ...(start && { $gte: start }), ...(end && { $lt: new Date(end.getTime() + 86400000) }) };
  const before = params.get('before');
  if (params.has('before')) {
    let cursor;
    try {
      if (!before || before.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(before)) throw new Error();
      cursor = JSON.parse(Buffer.from(before, 'base64url').toString());
      if (!cursor || Object.keys(cursor).sort().join(',') !== 'at,id' || !referencePattern.test(cursor.id)
        || typeof cursor.at !== 'string' || new Date(cursor.at).toISOString() !== cursor.at) throw new Error();
    } catch { throw authError('Invalid cursor'); }
    filter.$or = [{ createdAt: { $lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), _id: { $lt: cursor.id } }];
  }
  return filter;
}
export function createErrorReviewHandler({ authenticate, connect }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
    try {
      const userId = await authenticate(); if (!userId) throw authError('Not authenticated', 401);
      await connect(); await requireAdmin(userId);
      if (request.method !== 'GET') throw authError('Method not allowed', 405);
      const rows = await ErrorIncident.find(errorFilters(new URL(request.url).searchParams))
        .select('_id platform kind location code route method status version release environment digest count createdAt lastSeenAt')
        .sort({ createdAt: -1, _id: -1 }).limit(26).lean();
      const items = rows.slice(0, 25); const last = items.at(-1);
      return Response.json({ items, nextCursor: rows.length > 25 ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last._id })).toString('base64url') : null }, { headers });
    } catch (error) {
      const status = [400, 401, 403, 405].includes(error.status) ? error.status : 503;
      return Response.json({ error: status === 503 ? 'Error review is temporarily unavailable.' : error.message }, { status, headers });
    }
  };
}
