import { safeRoute, referencePattern } from './policy.js';
let pending = new Map();
export async function reportBrowserError(kind, { route = location.pathname, method, status, digest } = {}, originalFetch = window.fetch.bind(window)) {
  const safe = safeRoute(route);
  const key = JSON.stringify([kind, safe, method, status]);
  const previous = pending.get(key);
  if (previous && Date.now() - previous.at < 60000) return previous.promise;
  const promise = (async () => {
    try {
      const response = await originalFetch('/api/monitoring/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'web', kind, route: safe, version: '0.1.0', method, status, digest }), signal: AbortSignal.timeout(3000) });
      if (!response.ok) return null;
      const result = await response.json();
      return referencePattern.test(result.errorId) ? result.errorId : null;
    } catch { return null; }
  })();
  if (pending.size > 100) pending.clear();
  pending.set(key, { at: Date.now(), promise });
  return promise;
}
export function installBrowserMonitoring(notify, userId) {
  const original = window.fetch;
  let active = true;
  pending = new Map();
  const display = id => { if (active && id) notify(id); };
  const report = (kind, data) => reportBrowserError(kind, data, original.bind(window)).then(display);
  const failure = () => { void report('unhandled_error'); };
  const rejection = () => { void report('unhandled_rejection'); };
  window.addEventListener('error', failure); window.addEventListener('unhandledrejection', rejection);
  const monitored = async (input, init) => {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url || String(input), location.origin); } catch { return original.call(window, input, init); }
    const internal = url.origin === location.origin && !url.pathname.startsWith('/api/monitoring/') && url.pathname.startsWith('/api/');
    try {
      const response = await original.call(window, input, init);
      if (internal && response.status >= 500) {
        const id = response.headers.get('X-Error-Reference');
        if (referencePattern.test(id || '')) display(id);
        else if (userId) void report('http_failure', { route: url.pathname, method: init?.method || input?.method || 'GET', status: response.status });
      }
      return response;
    } catch (error) {
      if (internal && userId && error?.name !== 'AbortError' && init?.signal?.aborted !== true) void report('network_failure', { route: url.pathname, method: init?.method || input?.method || 'GET' });
      throw error;
    }
  };
  window.fetch = monitored;
  return () => {
    active = false; pending.clear(); window.removeEventListener('error', failure); window.removeEventListener('unhandledrejection', rejection);
    if (window.fetch === monitored) window.fetch = original;
  };
}
