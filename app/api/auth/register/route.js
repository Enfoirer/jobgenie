import dbConnect from '@/lib/mongodb';
import { createRegisterHandler } from '@/lib/auth/registerHandler';
export const POST = createRegisterHandler({ connect: dbConnect });
