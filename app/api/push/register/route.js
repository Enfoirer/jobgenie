import { observeRoute } from '@/lib/monitoring/server';
import { pushHandler } from '@/lib/push/handlers';
export const runtime = 'nodejs';
const POST = pushHandler('register');

const observedPOST = observeRoute(POST, '/api/push/register');
export { observedPOST as POST };
