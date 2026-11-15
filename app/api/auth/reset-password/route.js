import { observeRoute } from '@/lib/monitoring/server';
import dbConnect from '@/lib/mongodb';
import { createResetHandler } from '@/lib/auth/resetHandler';
const POST = createResetHandler({ connect: dbConnect, action: 'reset' });

const observedPOST = observeRoute(POST, '/api/auth/reset-password');
export { observedPOST as POST };
