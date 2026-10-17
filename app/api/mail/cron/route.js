import dbConnect from '@/lib/mongodb';
import { createMailSyncHandler, cronIdentity } from '@/lib/pipeline/mailSyncHandler';

export const GET = createMailSyncHandler({
  connect: dbConnect,
  authenticate: (request) => cronIdentity(request, process.env.CRON_SECRET),
});
