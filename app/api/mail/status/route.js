import { observeRoute } from '@/lib/monitoring/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { getMailSyncStatus } from '@/lib/mail/syncStatus';

async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    await dbConnect();
    return Response.json({ accounts: await getMailSyncStatus(session.user.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Unable to load sync status' }, { status: 500 });
  }
}

const observedGET = observeRoute(GET, '/api/mail/status');
export { observedGET as GET };
