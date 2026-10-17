import { getJob, updateJob, deleteJob } from '@/lib/jobs/jobMutations';
import dbConnect from '@/lib/mongodb';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';

const dependencies = {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
};

export const GET = createJobRoute(async ({ userId, params }) => ({
  job: await getJob(userId, params.id),
}), dependencies);
export const PATCH = createJobRoute(async ({ request, userId, params }) =>
  updateJob(userId, params.id, await readJobBody(request)), dependencies);
export const DELETE = createJobRoute(async ({ userId, params }) =>
  deleteJob(userId, params.id), dependencies);
