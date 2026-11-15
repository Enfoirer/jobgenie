import { observeRoute } from '@/lib/monitoring/server';
import { nativeOAuthHandler } from '@/lib/oauth/handlers';
const POST = nativeOAuthHandler('google', 'cancel');

const observedPOST = observeRoute(POST, '/api/oauth/google/native/cancel');
export { observedPOST as POST };
