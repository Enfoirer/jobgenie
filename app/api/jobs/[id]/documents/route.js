import { observeRoute } from '@/lib/monitoring/server';
import { documentHandler } from '@/lib/documents/handlers';
const GET = documentHandler('list');
const POST = documentHandler('link');

const observedGET = observeRoute(GET, '/api/jobs/[id]/documents');
export { observedGET as GET };

const observedPOST = observeRoute(POST, '/api/jobs/[id]/documents');
export { observedPOST as POST };
