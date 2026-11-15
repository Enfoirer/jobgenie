import { observeRoute } from '@/lib/monitoring/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createStatsRoute } from '@/lib/analytics/routeHandler';

export const dynamic = 'force-dynamic';
const GET = createStatsRoute({
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});

const observedGET = observeRoute(GET, '/api/stats');
export { observedGET as GET };
