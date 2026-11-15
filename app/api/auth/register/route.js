import { observeRoute } from '@/lib/monitoring/server';
import dbConnect from '@/lib/mongodb';
import { createRegisterHandler } from '@/lib/auth/registerHandler';
const POST = createRegisterHandler({ connect: dbConnect });

const observedPOST = observeRoute(POST, '/api/auth/register');
export { observedPOST as POST };
