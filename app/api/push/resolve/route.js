import { observeRoute } from '@/lib/monitoring/server';
import { pushHandler } from '@/lib/push/handlers';
export const runtime = 'nodejs';
const POST = pushHandler('resolve');

const observedPOST = observeRoute(POST, '/api/push/resolve');
export { observedPOST as POST };
