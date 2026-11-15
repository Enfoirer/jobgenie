import { observeRoute } from '@/lib/monitoring/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createFeedbackHandler } from '@/lib/feedback/routeHandler';

export const dynamic = 'force-dynamic';
const handler = createFeedbackHandler({
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});
const GET = handler;
const POST = handler;

const observedGET = observeRoute(GET, '/api/feedback');
export { observedGET as GET };

const observedPOST = observeRoute(POST, '/api/feedback');
export { observedPOST as POST };
