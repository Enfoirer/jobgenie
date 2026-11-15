import { observeRoute } from '@/lib/monitoring/server';
import { pushHandler } from '@/lib/push/handlers';
export const runtime = 'nodejs';
const POST = pushHandler('revoke');

const observedPOST = observeRoute(POST, '/api/push/revoke');
export { observedPOST as POST };
