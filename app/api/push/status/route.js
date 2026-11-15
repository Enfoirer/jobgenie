import { observeRoute } from '@/lib/monitoring/server';
import { pushHandler } from '@/lib/push/handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const GET = pushHandler('status');

const observedGET = observeRoute(GET, '/api/push/status');
export { observedGET as GET };
