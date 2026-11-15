import { observeRoute } from '@/lib/monitoring/server';
import { oauthHandler } from '@/lib/oauth/handlers';
const POST = oauthHandler('google', 'start');

const observedPOST = observeRoute(POST, '/api/oauth/google/start');
export { observedPOST as POST };
