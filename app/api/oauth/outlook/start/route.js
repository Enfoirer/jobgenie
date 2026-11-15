import { observeRoute } from '@/lib/monitoring/server';
import { oauthHandler } from '@/lib/oauth/handlers';
const POST = oauthHandler('outlook', 'start');

const observedPOST = observeRoute(POST, '/api/oauth/outlook/start');
export { observedPOST as POST };
