import { observeRoute } from '@/lib/monitoring/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createMailSyncHandler } from '@/lib/pipeline/mailSyncHandler';

const GET = createMailSyncHandler({
  connect: dbConnect,
  unauthorizedMessage: 'Not authenticated',
  authenticate: async () => {
    const session = await getServerSession(authOptions);
    return session?.user?.id ? { userId: session.user.id } : null;
  },
});

// Manual actions use POST; GET remains compatible with existing integrations.
const POST = GET;

const observedGET = observeRoute(GET, '/api/mail');
export { observedGET as GET };

const observedPOST = observeRoute(POST, '/api/mail');
export { observedPOST as POST };
