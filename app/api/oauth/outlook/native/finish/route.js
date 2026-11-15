import { observeRoute } from '@/lib/monitoring/server';
import { nativeOAuthHandler } from '@/lib/oauth/handlers';
const POST = nativeOAuthHandler('outlook', 'finish');

const observedPOST = observeRoute(POST, '/api/oauth/outlook/native/finish');
export { observedPOST as POST };
