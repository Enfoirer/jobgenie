import { observeRoute } from '@/lib/monitoring/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createJobRoute, readJobBody } from '@/lib/jobs/routeHandler';
import { saveReminderSettings } from '@/lib/reminders/reminders';

const PATCH = createJobRoute(async ({ userId, request }) => saveReminderSettings(userId, await readJobBody(request)), {
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});

const observedPATCH = observeRoute(PATCH, '/api/reminders/settings');
export { observedPATCH as PATCH };
