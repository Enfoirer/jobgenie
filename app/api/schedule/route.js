import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createJobRoute } from '@/lib/jobs/routeHandler';
import { listSchedule } from '@/lib/schedule/listSchedule';

export const dynamic = 'force-dynamic';
const load = createJobRoute(async ({ userId }) => ({ events: await listSchedule(userId) }), {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});

export async function GET(request, context) {
  const response = await load(request, context);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
