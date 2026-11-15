import { observeRoute } from '@/lib/monitoring/server';
import { changeHistory } from '@/lib/jobs/jobMutations';
import dbConnect from '@/lib/mongodb';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';

const dependencies = {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
};

const PATCH = createJobRoute(async ({ request, userId, params }) =>
  changeHistory(userId, params.id, params.statusId, await readJobBody(request)), dependencies);
const DELETE = createJobRoute(async ({ userId, params }) =>
  changeHistory(userId, params.id, params.statusId, null, true), dependencies);

const observedPATCH = observeRoute(PATCH, '/api/jobs/[id]/status-history/[statusId]');
export { observedPATCH as PATCH };

const observedDELETE = observeRoute(DELETE, '/api/jobs/[id]/status-history/[statusId]');
export { observedDELETE as DELETE };
