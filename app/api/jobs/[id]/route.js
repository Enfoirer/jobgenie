import { observeRoute } from '@/lib/monitoring/server';
import { getJob, updateJob, deleteJob } from '@/lib/jobs/jobMutations';
import dbConnect from '@/lib/mongodb';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';

const dependencies = {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
};

const GET = createJobRoute(async ({ userId, params }) => ({
  job: await getJob(userId, params.id),
}), dependencies);
const PATCH = createJobRoute(async ({ request, userId, params }) =>
  updateJob(userId, params.id, await readJobBody(request)), dependencies);
const DELETE = createJobRoute(async ({ userId, params }) =>
  deleteJob(userId, params.id), dependencies);

const observedGET = observeRoute(GET, '/api/jobs/[id]');
export { observedGET as GET };

const observedPATCH = observeRoute(PATCH, '/api/jobs/[id]');
export { observedPATCH as PATCH };

const observedDELETE = observeRoute(DELETE, '/api/jobs/[id]');
export { observedDELETE as DELETE };
