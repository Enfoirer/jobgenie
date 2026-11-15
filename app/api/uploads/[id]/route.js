import { observeRoute } from '@/lib/monitoring/server';
import { uploadHandler } from '@/lib/uploads/handlers';
const DELETE = uploadHandler('delete');

const observedDELETE = observeRoute(DELETE, '/api/uploads/[id]');
export { observedDELETE as DELETE };
