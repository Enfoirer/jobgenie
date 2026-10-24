import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createOAuthHandler } from './routeHandler';
import { createNativeOAuthHandler } from './native';

const dependencies = (provider, action) => ({
  provider, action, connect: dbConnect,
  authenticate: async () => {
    const session = await getServerSession(authOptions);
    return session?.user?.id ? { userId: session.user.id, sessionId: session.user.sessionId } : null;
  },
});

export const nativeOAuthHandler = (provider, action) => createNativeOAuthHandler(dependencies(provider, action));
export const oauthHandler = (provider, action) => request => {
  const native = action === 'callback' && new URL(request.url).searchParams.get('state')?.startsWith('native_');
  return (native ? nativeOAuthHandler(provider, action) : createOAuthHandler(dependencies(provider, action)))(request);
};
