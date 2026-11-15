import { observeRoute } from '@/lib/monitoring/server';
import { nativeOAuthHandler } from '@/lib/oauth/handlers';
const POST = nativeOAuthHandler('google', 'start');

const observedPOST = observeRoute(POST, '/api/oauth/google/native/start');
export { observedPOST as POST };
