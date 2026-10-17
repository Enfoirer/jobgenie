import { changeHistory } from '@/lib/jobs/jobMutations';
import dbConnect from '@/lib/mongodb';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';

const dependencies = {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
};

export const PATCH = createJobRoute(async ({ request, userId, params }) =>
  changeHistory(userId, params.id, params.statusId, await readJobBody(request)), dependencies);
export const DELETE = createJobRoute(async ({ userId, params }) =>
  changeHistory(userId, params.id, params.statusId, null, true), dependencies);
