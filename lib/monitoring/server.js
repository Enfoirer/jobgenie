import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import ErrorIncident from '../models/ErrorIncident.js';
import { safeIncident } from './policy.js';
const context = new AsyncLocalStorage();
export function noteFailure(error) {
  const current = context.getStore();
  if (!current) return;
  current.kind = error?.name === 'TypeError' ? 'type_error' : ['MongoServerError', 'MongoNetworkError', 'MongooseServerSelectionError'].includes(error?.name) ? 'database_failure' : 'server_exception';
  current.code = error?.code;
  if (typeof error?.stack === 'string') {
    const lines = error.stack.split('\n').slice(1);
    const frame = lines.map(line => line.match(/\/((?:(?:lib|app)\/[a-zA-Z0-9/_\[\].-]+\.jsx?|chunks\/[a-zA-Z0-9_.-]+\.js):\d{1,8}:\d{1,8})\)?$/)?.[1]).find(Boolean);
    current.location = frame;
  }
}
export async function recordIncident(input, { actor = 'server', now = Date.now(), connect, write, log = console.error } = {}) {
  const incident = safeIncident(input);
  const errorId = `JG-${randomUUID()}`;
  const dedupeKey = createHash('sha256').update(JSON.stringify([actor, incident, Math.floor(now / 60000)])).digest('hex');
  let timer;
  try {
    const persist = async () => {
      if (connect) await connect();
      else { const { default: dbConnect } = await import('../mongodb.js'); await dbConnect(); }
      const operation = write || (async () => {
        await ErrorIncident.init();
        return ErrorIncident.findOneAndUpdate({ dedupeKey }, {
          $setOnInsert: { _id: errorId, ...incident, createdAt: new Date(now), expiresAt: new Date(now + 30 * 86400000) },
          $inc: { count: 1 }, $set: { lastSeenAt: new Date(now) },
        }, { upsert: true, new: true }).lean();
      });
      let row;
      try { row = await operation(); }
      catch (error) {
        if (error.code !== 11000 || write) throw error;
        row = await ErrorIncident.findOneAndUpdate({ dedupeKey }, { $inc: { count: 1 }, $set: { lastSeenAt: new Date(now) } }, { new: true }).lean();
      }
      return { errorId: row._id, stored: true };
    };
    return await Promise.race([persist(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic timeout')), 2000); })]);
  } catch {
    // Only allowlisted metadata enters the fallback log, even when MongoDB is down.
    log(JSON.stringify({ event: 'jobgenie_error', errorId, ...incident, stored: false }));
    return { errorId, stored: false };
  } finally { clearTimeout(timer); }
}
export function observeRoute(handler, route, reporter = recordIncident) {
  return (request, ...args) => context.run({}, async () => {
    let response;
    try { response = await handler(request, ...args); }
    catch (error) {
      // Preserve framework redirects and not-found control flow.
      if (typeof error?.digest === 'string' && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(error.digest)) throw error;
      noteFailure(error);
      response = new Response(null, { status: 500 });
    }
    if (!(response instanceof Response) || response.status < 500) return response;
    const result = await reporter({ platform: 'server', kind: context.getStore()?.kind || 'http_failure', route,
      method: request.method, status: response.status, version: '0.1.0', location: context.getStore()?.location, code: context.getStore()?.code });
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json'); headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Error-Reference', result.errorId); headers.delete('Content-Length');
    return Response.json({ error: `Service temporarily unavailable. Reference ${result.errorId}`, ...result }, { status: response.status, headers });
  });
}
