import MailAccount from '../models/MailAccount.js';
import { parseMailSyncOptions } from '../mail/syncOptions.js';
import { syncMailAccounts } from './mailSync.js';

// Auth is specific to each entry point; validation, account selection, processing,
// response shape and errors are shared. Injectable dependencies allow HTTP-level
// tests without a production database or a logged-in browser.
export function createMailSyncHandler({
  authenticate,
  connect,
  unauthorizedMessage = 'Unauthorized',
  findAccounts = (query) => MailAccount.find(query),
  sync = syncMailAccounts,
}) {
  return async function GET(request) {
    try {
      const identity = await authenticate(request);
      if (!identity) return Response.json({ error: unauthorizedMessage }, { status: 401 });
      const { provider, limit } = parseMailSyncOptions(new URL(request.url).searchParams);
      const query = { ...(identity.userId ? { userId: identity.userId } : {}), ...(provider ? { provider } : {}) };
      await connect();
      const accounts = await findAccounts(query);
      return Response.json(await sync(accounts, { limit }));
    } catch (error) {
      const status = error.status === 400 ? 400 : 500;
      return Response.json(
        status === 400 ? { error: error.message } : { error: 'Failed to sync mail', details: error.message },
        { status }
      );
    }
  };
}

export function cronIdentity(request, secret) {
  const auth = request.headers.get('authorization') || '';
  const token = new URL(request.url).searchParams.get('token');
  return secret && (auth === `Bearer ${secret}` || token === secret) ? {} : null;
}
