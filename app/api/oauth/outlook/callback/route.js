import { observeRoute } from '@/lib/monitoring/server';
import { oauthHandler } from '@/lib/oauth/handlers';
const GET = oauthHandler('outlook', 'callback');

const observedGET = observeRoute(GET, '/api/oauth/outlook/callback');
export { observedGET as GET };
