import { observeRoute } from '@/lib/monitoring/server';
import Job from '@/lib/models/Job';
import { createJob } from '@/lib/jobs/jobMutations';
import dbConnect from '@/lib/mongodb';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';

const dependencies = {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
};

const GET = createJobRoute(async ({ request, userId }) => ({
  jobs: await Job.find({ userId, ...(new URL(request.url).searchParams.get('includeArchived') === 'true' ? {} : { archivedAt: null }) }).sort({ createdAt: -1 }),
}), dependencies);
const POST = createJobRoute(async ({ request, userId }) =>
  createJob(userId, await readJobBody(request)), { ...dependencies, successStatus: 201 });

const observedGET = observeRoute(GET, '/api/jobs');
export { observedGET as GET };

const observedPOST = observeRoute(POST, '/api/jobs');
export { observedPOST as POST };
