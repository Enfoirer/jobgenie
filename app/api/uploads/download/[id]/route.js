import { observeRoute } from '@/lib/monitoring/server';
import { uploadHandler } from '@/lib/uploads/handlers';
const GET = uploadHandler('download');

const observedGET = observeRoute(GET, '/api/uploads/download/[id]');
export { observedGET as GET };
