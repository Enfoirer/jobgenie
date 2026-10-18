import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createUploadHandler } from './routeHandler';

export const uploadHandler = (action) => createUploadHandler({
  action, connect: dbConnect,
  authenticate: async () => (await getServerSession(authOptions))?.user?.id || null,
});
