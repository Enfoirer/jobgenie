import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createPushHandler } from './routeHandler';
import { ensurePushIndexes } from './indexes';

export function pushHandler(action) {
  return createPushHandler({ action, connect: async () => { await dbConnect(); await ensurePushIndexes(); }, authenticate: async () => {
    const session = await getServerSession(authOptions);
    return session?.user?.id ? { userId: session.user.id, sessionId: session.user.sessionId, expires: session.expires, authVersion: session.user.authVersion } : null;
  } });
}
