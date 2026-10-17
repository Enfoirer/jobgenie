// Small adapter shared by the job APIs; authenticate before opening a DB connection.
export function createJobRoute(operation, { authenticate, connect, successStatus = 200 }) {
  return async (request, context = {}) => {
    try {
      const userId = await authenticate();
      if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 });
      await connect();
      const params = await context.params || {};
      return Response.json(await operation({ request, params, userId }), { status: successStatus });
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error('Job API error:', error);
      return Response.json({ error: status === 500 ? 'Unable to save or load application data. Please try again.' : error.message }, { status });
    }
  };
}
export async function readJobBody(request) {
  try { return await request.json(); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}
