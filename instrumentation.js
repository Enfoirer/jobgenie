export async function onRequestError(error, request, context) {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { recordIncident } = await import('./lib/monitoring/server.js');
    await recordIncident({ platform: 'server', kind: 'render_error', route: context.routePath,
      method: request.method, status: 500, version: '0.1.0', digest: error?.digest });
  }
}
