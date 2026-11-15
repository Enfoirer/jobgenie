import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installBrowserMonitoring } from '../lib/monitoring/browser.js';

test('browser reports only safe metadata, deduplicates, and ignores reporting failures', async () => {
  const events = new EventTarget(), calls = [], notices = [];
  globalThis.location = { origin: 'https://example.test', pathname: '/dashboard/jobs' };
  globalThis.window = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), fetch: async (url, init) => {
    calls.push({ url, init });
    if (url === '/api/monitoring/report') return Response.json({ errorId: 'JG-00000000-0000-4000-8000-000000000001' });
    return new Response('private response body', { status: 503, headers: { 'X-Error-Reference': 'JG-00000000-0000-4000-8000-000000000002' } });
  } };
  const stop = installBrowserMonitoring(id => notices.push(id), 'owner');
  try {
    await window.fetch('/api/jobs?token=fixture-secret', { method: 'POST', body: 'password=fixture-secret' });
    assert.equal(calls.length, 1); assert.equal(notices[0], 'JG-00000000-0000-4000-8000-000000000002');
    events.dispatchEvent(new Event('error')); events.dispatchEvent(new Event('error'));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls.length, 2);
    const report = JSON.parse(calls[1].init.body);
    assert.equal(report.route, '/dashboard/jobs'); assert.equal(report.kind, 'unhandled_error');
    assert.equal(calls[1].init.body.includes('fixture-secret'), false);
    stop(); events.dispatchEvent(new Event('error')); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(calls.length, 2);
  } finally { stop(); delete globalThis.window; delete globalThis.location; }
});
test('report transport failure does not recursively generate incidents', async () => {
  const events = new EventTarget(); let count = 0;
  globalThis.location = { origin: 'https://example.test', pathname: '/dashboard/jobs' };
  globalThis.window = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), fetch: async () => { count++; throw new TypeError('fixture secret'); } };
  const stop = installBrowserMonitoring(() => assert.fail('No fabricated reference'), 'owner');
  try {
    events.dispatchEvent(new Event('error')); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(count, 1);
  } finally { stop(); delete globalThis.window; delete globalThis.location; }
});
