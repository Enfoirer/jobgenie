import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createStatsRoute } from '@/lib/analytics/routeHandler';

export const dynamic = 'force-dynamic';
export const GET = createStatsRoute({
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});
