import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createDocumentHandler } from './routeHandler';
export const documentHandler = action => createDocumentHandler({ action, connect: dbConnect,
  authenticate: async () => (await getServerSession(authOptions))?.user?.id });
