import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createFeedbackHandler } from '@/lib/feedback/routeHandler';

export const dynamic = 'force-dynamic';
const handler = createFeedbackHandler({
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});
export const GET = handler;
export const POST = handler;
