// Next.js can rewrite request.url to its internal host behind a proxy. Use the
// configured public origin, never an arbitrary forwarded-host header.
export function isSameOriginRequest(request, publicURL = process.env.NEXTAUTH_URL) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  try { return origin === new URL(publicURL || request.url).origin; }
  catch { return false; }
}
