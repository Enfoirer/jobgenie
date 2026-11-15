import { observeRoute } from '@/lib/monitoring/server';
import { uploadHandler } from '@/lib/uploads/handlers';
const GET = uploadHandler('list');
const POST = uploadHandler('create');

const observedGET = observeRoute(GET, '/api/uploads');
export { observedGET as GET };

const observedPOST = observeRoute(POST, '/api/uploads');
export { observedPOST as POST };
