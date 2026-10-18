import MailAccount from '../models/MailAccount.js';
import { parseMailSyncOptions } from '../mail/syncOptions.js';
import { syncMailAccounts } from './mailSync.js';
import { isSameOriginRequest } from '../auth/requestOrigin.js';

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
      let action;
      let accountId;
      if (request.method === 'POST') {
        if (!isSameOriginRequest(request)) {
          return Response.json({ error: 'Invalid origin' }, { status: 403 });
        }
        let body;
        try { body = await request.json(); } catch { body = null; }
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            !['sync', 'retry'].includes(body.action) ||
            (body.accountId !== undefined && (typeof body.accountId !== 'string' || !/^[a-f0-9]{24}$/i.test(body.accountId))) ||
            Object.keys(body).some((key) => !['action', 'accountId'].includes(key))) {
          return Response.json({ error: 'Invalid sync action or account' }, { status: 400 });
        }
        action = body.action;
        accountId = body.accountId;
      }
      const query = { ...(identity.userId ? { userId: identity.userId } : {}), ...(provider ? { provider } : {}), ...(accountId ? { _id: accountId } : {}) };
      await connect();
      const accounts = await findAccounts(query);
      if (accountId && accounts.length === 0) return Response.json({ error: 'Account not found' }, { status: 404 });
      const result = await sync(accounts, { limit, ...(action === 'retry' ? { retryOnly: true } : {}) });
      // Keep historical GET response compatibility. The UI receives counts only.
      if (request.method === 'POST') {
        const { emails: _emails, errors = [], ...summary } = result;
        return Response.json({ ...summary, errors: errors.map(({ accountId, stage }) => ({ accountId, stage })) }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return Response.json(result);
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
