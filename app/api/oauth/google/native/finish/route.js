import { observeRoute } from '@/lib/monitoring/server';
import { nativeOAuthHandler } from '@/lib/oauth/handlers';
const POST = nativeOAuthHandler('google', 'finish');

const observedPOST = observeRoute(POST, '/api/oauth/google/native/finish');
export { observedPOST as POST };
