import { observeRoute } from '@/lib/monitoring/server';
import { pushHandler } from '@/lib/push/handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const GET = pushHandler('cron');
const POST = GET;

const observedGET = observeRoute(GET, '/api/push/cron');
export { observedGET as GET };

const observedPOST = observeRoute(POST, '/api/push/cron');
export { observedPOST as POST };
