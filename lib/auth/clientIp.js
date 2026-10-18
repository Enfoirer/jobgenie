import { isIP } from 'node:net';

export function headerValue(request, name) {
  return request?.headers?.get?.(name) ?? request?.headers?.[name] ?? '';
}

export function clientIp(request, vercel = process.env.VERCEL === '1') {
  // Only the deployment platform's overwritten header is trusted. A generic
  // forwarding header from an arbitrary client must not reset a rate bucket.
  const value = vercel ? headerValue(request, 'x-vercel-forwarded-for') : '';
  if (typeof value !== 'string' || !isIP(value.trim())) return 'anonymous';
  const ip = value.trim();
  return isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname.toLowerCase() : ip;
}
