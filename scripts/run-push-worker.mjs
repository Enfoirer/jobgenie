// Run under a process supervisor, or use --once from an external scheduler.
// Credentials stay in server environment variables, never URL query strings.
import { setTimeout as delay } from 'node:timers/promises';

const origin = process.env.NEXTAUTH_URL;
const secret = process.env.CRON_SECRET;
let url;
try { url = new URL('/api/push/cron', origin); } catch { throw new Error('Set NEXTAUTH_URL to the public HTTPS origin.'); }
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('An HTTPS worker endpoint is required.');
if (!secret || secret.length < 32) throw new Error('Set CRON_SECRET to at least 32 random characters.');
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
do {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const counts = Object.fromEntries(['busy', 'devices', 'attempted', 'sent', 'retry', 'rejected', 'unknown', 'cancelled']
      .filter(key => typeof result[key] === 'boolean' || Number.isSafeInteger(result[key])).map(key => [key, result[key]]));
    console.log(JSON.stringify({ at: new Date().toISOString(), ...counts }));
  } catch {
    if (!controller.signal.aborted) console.error('Push worker request failed. Check server configuration and scheduler access.');
    if (process.argv.includes('--once')) process.exitCode = 1;
  }
  if (process.argv.includes('--once') || controller.signal.aborted) break;
  try { await delay(Math.max(0, 60000 - (Date.now() - started)), undefined, { signal: controller.signal }); } catch { break; }
} while (!controller.signal.aborted);
