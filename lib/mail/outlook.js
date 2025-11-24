// lib/mail/outlook.js
const DEFAULT_TENANT = process.env.OUTLOOK_TENANT_ID || 'common';
const OUTLOOK_TOKEN_ENDPOINT = `https://login.microsoftonline.com/${DEFAULT_TENANT}/oauth2/v2.0/token`;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function buildAuthorizationHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function refreshOutlookToken(refreshToken) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing OUTLOOK_CLIENT_ID or OUTLOOK_CLIENT_SECRET');
  }

  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('refresh_token', refreshToken);
  params.set('grant_type', 'refresh_token');
  params.set('scope', 'https://graph.microsoft.com/.default offline_access Mail.Read');

  const res = await fetch(OUTLOOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to refresh Outlook token: ${res.status} ${res.statusText} - ${text}`
    );
  }

  const data = await res.json();
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : undefined;

  return {
    accessToken: data.access_token,
    expiresAt,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

async function ensureOutlookAccessToken(account) {
  const now = new Date();
  const needsRefresh =
    account.expiresAt && new Date(account.expiresAt).getTime() <= now.getTime();

  if (needsRefresh) {
    if (!account.refreshToken) {
      throw new Error(
        'Outlook access token expired and no refresh token present'
      );
    }
    const refreshed = await refreshOutlookToken(account.refreshToken);
    account.accessToken = refreshed.accessToken;
    account.expiresAt = refreshed.expiresAt;
    account.scope = refreshed.scope || account.scope;
    if (typeof account.save === 'function') {
      await account.save();
    }
  }

  return account.accessToken;
}

export async function fetchOutlookMessages(account, { limit = 10 } = {}) {
  const accessToken = await ensureOutlookAccessToken(account);
  const url = `${GRAPH_BASE}/me/mailFolders/Inbox/messages?$top=${limit}&$select=sender,from,toRecipients,subject,bodyPreview,receivedDateTime,conversationId,internetMessageId`;

  const res = await fetch(url, { headers: buildAuthorizationHeader(accessToken) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to list Outlook messages: ${res.status} ${res.statusText} - ${text}`
    );
  }

  const data = await res.json();
  if (!data.value || data.value.length === 0) {
    return [];
  }

  return data.value.map((item) => ({
    provider: 'outlook',
    id: item.id,
    threadId: item.conversationId,
    from: item.from?.emailAddress?.address || item.sender?.emailAddress?.address,
    to: Array.isArray(item.toRecipients)
      ? item.toRecipients.map((r) => r.emailAddress?.address).filter(Boolean).join(', ')
      : undefined,
    subject: item.subject,
    snippet: item.bodyPreview,
    receivedAt: item.receivedDateTime,
    internetMessageId: item.internetMessageId,
  }));
}
