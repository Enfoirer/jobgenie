import { observeRoute } from '@/lib/monitoring/server';
import { documentHandler } from '@/lib/documents/handlers';
const GET = documentHandler('download');

const observedGET = observeRoute(GET, '/api/jobs/[id]/documents/[documentId]');
export { observedGET as GET };
