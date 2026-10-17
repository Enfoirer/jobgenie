import { listHistory, addHistory } from '@/lib/jobs/jobMutations';
import dbConnect from '@/lib/mongodb';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';

const dependencies = {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
};

export const GET = createJobRoute(async ({ userId, params }) => ({
  statusHistory: await listHistory(userId, params.id),
}), dependencies);
export const POST = createJobRoute(async ({ request, userId, params }) =>
  addHistory(userId, params.id, await readJobBody(request)), { ...dependencies, successStatus: 201 });
