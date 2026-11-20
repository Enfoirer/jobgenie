import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createOnboardingHandler } from '@/lib/onboarding/routeHandler';
import { observeRoute } from '@/lib/monitoring/server';

export const dynamic = 'force-dynamic';
const handler = createOnboardingHandler({
  authenticate: async () => (await getServerSession(authOptions))?.user?.id,
  connect: dbConnect,
});
export const GET = observeRoute(handler, '/api/onboarding');
export const POST = observeRoute(handler, '/api/onboarding');
