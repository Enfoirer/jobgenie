import { observeRoute } from '@/lib/monitoring/server';
import { nativeOAuthHandler } from '@/lib/oauth/handlers';
const POST = nativeOAuthHandler('outlook', 'cancel');

const observedPOST = observeRoute(POST, '/api/oauth/outlook/native/cancel');
export { observedPOST as POST };
