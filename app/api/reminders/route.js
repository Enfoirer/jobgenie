import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';
import { listReminders, actOnReminder } from '@/lib/reminders/reminders';

export const dynamic = 'force-dynamic';
const dependencies = { authenticate: async () => (await getServerSession(authOptions))?.user?.id, connect: dbConnect };
const load = createJobRoute(async ({ userId }) => listReminders(userId), dependencies);
export async function GET(request, context) {
  const response = await load(request, context);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const PATCH = createJobRoute(async ({ userId, request }) => actOnReminder(userId, await readJobBody(request)), dependencies);
