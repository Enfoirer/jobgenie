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

export const GET = createJobRoute(async ({ userId }) => ({
  jobs: await Job.find({ userId }).sort({ createdAt: -1 }),
}), dependencies);
export const POST = createJobRoute(async ({ request, userId }) =>
  createJob(userId, await readJobBody(request)), { ...dependencies, successStatus: 201 });
