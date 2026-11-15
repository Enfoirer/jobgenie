import { observeRoute } from '@/lib/monitoring/server';
import { listHistory, addHistory } from '@/lib/jobs/jobMutations';
import dbConnect from '@/lib/mongodb';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';

const dependencies = {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
};

const GET = createJobRoute(async ({ userId, params }) => ({
  statusHistory: await listHistory(userId, params.id),
}), dependencies);
const POST = createJobRoute(async ({ request, userId, params }) =>
  addHistory(userId, params.id, await readJobBody(request)), { ...dependencies, successStatus: 201 });

const observedGET = observeRoute(GET, '/api/jobs/[id]/status-history');
export { observedGET as GET };

const observedPOST = observeRoute(POST, '/api/jobs/[id]/status-history');
export { observedPOST as POST };
