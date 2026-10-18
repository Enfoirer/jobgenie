import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createOAuthHandler } from './routeHandler';

export const oauthHandler = (provider, action) => createOAuthHandler({
  provider, action, connect: dbConnect,
  authenticate: async () => {
    const session = await getServerSession(authOptions);
    return session?.user?.id ? { userId: session.user.id, sessionId: session.user.sessionId } : null;
  },
});
