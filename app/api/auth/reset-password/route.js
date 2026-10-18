import dbConnect from '@/lib/mongodb';
import { createResetHandler } from '@/lib/auth/resetHandler';
export const POST = createResetHandler({ connect: dbConnect, action: 'reset' });
