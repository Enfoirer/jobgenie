export const KINDS = ['http_failure', 'network_failure', 'invalid_response', 'unhandled_error', 'unhandled_rejection', 'render_error', 'database_failure', 'type_error', 'server_exception'];
export const referencePattern = /^JG-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function safeVersion(value) { return typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\+\d{1,8})?$/.test(value) ? value : 'unknown'; }
// Catalog entries are application routes, never URLs containing identifiers or queries.
export function safeRoute(value) {
  if (typeof value !== 'string') return 'unknown';
  const pathname = value.split(/[?#]/)[0];
  const segments = pathname.split('/').filter(Boolean);
  const allowed = new Set(['api', 'dashboard', 'jobs', 'add', 'todo', 'analytics', 'upload', 'uploads', 'download', 'pending', 'clear', 'bulk', 'mail', 'status', 'accounts', 'cron', 'schedule', 'reminders', 'settings', 'sync-settings', 'feedback', 'admin', 'errors', 'monitoring', 'onboarding', 'report', 'auth', 'session', 'csrf', 'callback', 'credentials', 'register', 'forgot-password', 'reset-password', 'login', 'oauth', 'google', 'outlook', 'native', 'start', 'finish', 'cancel', 'push', 'revoke', 'resolve', 'access', 'documents', 'status-history', 'stats', 'signout', 'providers', 'error']);
  if (segments.length > 9) return 'unknown';
  const result = [];
  for (const segment of segments) {
    if (allowed.has(segment)) result.push(segment);
    else if (/^(?:[a-f0-9]{24}|\[(?:id|statusId|documentId|\.\.\.nextauth)\])$/i.test(segment)) result.push('[id]');
    else return 'unknown';
  }
  return '/' + result.join('/');
}
export function safeIncident(input, env = process.env) {
  return {
    platform: ['server', 'web', 'ios'].includes(input.platform) ? input.platform : 'web',
    kind: KINDS.includes(input.kind) ? input.kind : 'server_exception',
    location: typeof input.location === 'string' && /:\d{1,8}:\d{1,8}$/.test(input.location)
      && LOCATIONS.has(input.location.replace(/:\d+:\d+$/, '')) ? input.location : null,
    code: ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ENOENT', '11000'].includes(String(input.code)) ? String(input.code) : null,
    route: safeRoute(input.route),
    method: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS'].includes(input.method) ? input.method : 'unknown',
    status: Number.isInteger(input.status) && input.status >= 400 && input.status <= 599 ? input.status : null,
    version: safeVersion(input.version),
    release: /^[a-f0-9]{40}$/i.test(env.VERCEL_GIT_COMMIT_SHA || '') ? env.VERCEL_GIT_COMMIT_SHA : 'unknown',
    environment: ['production', 'development', 'test'].includes(env.NODE_ENV) ? env.NODE_ENV : 'unknown',
    digest: typeof input.digest === 'string' && /^\d{1,20}$/.test(input.digest) ? input.digest : null,
  };
}
import { LOCATIONS } from './locations.js';
