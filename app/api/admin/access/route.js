import { observeRoute } from '@/lib/monitoring/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createAdminFeedbackHandler } from '@/lib/admin/feedback';
export const dynamic = 'force-dynamic';
const GET = createAdminFeedbackHandler({ authenticate: async () => (await getServerSession(authOptions))?.user?.id, connect: dbConnect, accessOnly: true });

const observedGET = observeRoute(GET, '/api/admin/access');
export { observedGET as GET };
