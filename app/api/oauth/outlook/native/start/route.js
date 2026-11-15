import { observeRoute } from '@/lib/monitoring/server';
import { nativeOAuthHandler } from '@/lib/oauth/handlers';
const POST = nativeOAuthHandler('outlook', 'start');

const observedPOST = observeRoute(POST, '/api/oauth/outlook/native/start');
export { observedPOST as POST };
