import { observeRoute } from '@/lib/monitoring/server';
import { oauthHandler } from '@/lib/oauth/handlers';
const GET = oauthHandler('google', 'callback');

const observedGET = observeRoute(GET, '/api/oauth/google/callback');
export { observedGET as GET };
