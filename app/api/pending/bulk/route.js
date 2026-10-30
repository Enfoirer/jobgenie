import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';
import { bulkPending } from '@/lib/jobs/bulkActions';

export const POST = createJobRoute(async ({ request, userId }) => bulkPending(userId, await readJobBody(request)), {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});
