import { parseStatsRange } from './range.js';
import { loadStats } from './stats.js';

export function createStatsRoute({ authenticate, connect, read = loadStats, clock = Date.now }) {
  return async (request) => {
    let result, status = 200;
    try {
      const userId = await authenticate();
      if (!userId) throw Object.assign(new Error('Not authenticated'), { status: 401 });
      const range = parseStatsRange(new URL(request.url).searchParams, clock());
      await connect();
      result = await read(userId, range);
    } catch (error) {
      status = error.status || 500;
      if (status === 500) console.error('Analytics API error:', error);
      result = { error: status === 500 ? 'Unable to load analytics. Please retry.' : error.message };
    }
    return Response.json(result, { status, headers: { 'Cache-Control': 'private, no-store' } });
  };
}
