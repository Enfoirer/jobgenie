import { observeRoute } from '@/lib/monitoring/server';
import dbConnect from '@/lib/mongodb';
import { createMailSyncHandler, cronIdentity } from '@/lib/pipeline/mailSyncHandler';

const GET = createMailSyncHandler({
  connect: dbConnect,
  authenticate: (request) => cronIdentity(request, process.env.CRON_SECRET),
});

const observedGET = observeRoute(GET, '/api/mail/cron');
export { observedGET as GET };
