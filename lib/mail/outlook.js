import { normalizeSyncLimit } from './syncOptions.js';

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

// Follow opaque Graph nextLinks unchanged. A fixed upper bound separates this
// scan from newly arriving mail; the completed watermark advances only at EOF.
export async function fetchOutlookMessages(account, { limit = 10 } = {}) {
  limit = normalizeSyncLimit(limit);
  const accessToken = await ensureOutlookAccessToken(account);
  const metadata = account.metadata || {};
  let state = metadata.outlookSync ? structuredClone(metadata.outlookSync) : startOutlookScan(metadata, limit);
  let pagesFetched = 0;
  let cursorResets = 0;
  const messages = [];
  const visitedPages = new Set();
  while (state && messages.length < limit) {
    if (!state.remainingMessages.length) {
      if (!state.nextLink) break;
      if (pagesFetched >= 10) break;
      validateGraphLink(state.nextLink);
      if (visitedPages.has(state.nextLink)) throw new Error('Outlook repeated a pagination link');
      visitedPages.add(state.nextLink);
      const response = await fetch(state.nextLink, { headers: buildAuthorizationHeader(accessToken) });
      if (!response.ok) {
        if (state.isContinuation && [400, 410].includes(response.status) && cursorResets === 0) {
          state = startOutlookScan(metadata, limit);
          visitedPages.clear();
          cursorResets++;
          continue;
        }
        throw new Error(`Outlook request failed (${response.status})`);
      }
      const page = await response.json();
      if (!Array.isArray(page.value)) throw new Error('Outlook page has no message list');
      state.remainingMessages = page.value.map(normalizeOutlookMessage);
      state.nextLink = page['@odata.nextLink'] || null;
      if (state.nextLink) validateGraphLink(state.nextLink);
      state.isContinuation = true;
      pagesFetched++;
    }
    const count = Math.min(state.remainingMessages.length, limit - messages.length);
    const selected = state.remainingMessages.splice(0, count);
    messages.push(...selected);
    for (const message of selected) {
      const received = new Date(message.receivedAt).getTime();
      if (!state.latestReceivedAt || received > new Date(state.latestReceivedAt).getTime()) {
        state.latestReceivedAt = message.receivedAt;
      }
    }
    if (!state.remainingMessages.length && !state.nextLink) {
      return {
        messages, pagesFetched, cursorResets, hasMore: false,
        cursor: { outlookSync: null, ...(state.latestReceivedAt ? { lastReceivedAt: new Date(state.latestReceivedAt) } : {}) },
      };
    }
  }
  return { messages, pagesFetched, cursorResets, hasMore: true, cursor: { outlookSync: state } };
}

function startOutlookScan(metadata, limit) {
  const upperBound = new Date().toISOString();
  const lastReceivedAt = metadata.lastReceivedAt ? new Date(metadata.lastReceivedAt).toISOString() : null;
  const params = new URLSearchParams({
    '$top': String(limit), '$orderby': 'receivedDateTime desc',
    '$select': 'sender,from,toRecipients,subject,bodyPreview,body,receivedDateTime,conversationId,internetMessageId',
    '$filter': `${lastReceivedAt ? `receivedDateTime ge ${lastReceivedAt} and ` : ''}receivedDateTime le ${upperBound}`,
  });
  return {
    nextLink: `${GRAPH_BASE}/me/mailFolders/Inbox/messages?${params}`,
    remainingMessages: [], latestReceivedAt: lastReceivedAt, isContinuation: false,
  };
}

function validateGraphLink(link) {
  const url = new URL(link);
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password) {
    throw new Error('Invalid Outlook pagination link');
  }
}

function normalizeOutlookMessage(item) {
  if (typeof item.id !== 'string' || !item.id || !Number.isFinite(new Date(item.receivedDateTime).getTime())) {
    throw new Error('Outlook page has an invalid message ID or received time');
  }
  return {
    provider: 'outlook', id: item.id, threadId: item.conversationId,
    from: item.from?.emailAddress?.address || item.sender?.emailAddress?.address,
    to: Array.isArray(item.toRecipients)
      ? item.toRecipients.map((r) => r.emailAddress?.address).filter(Boolean).join(', ')
      : undefined,
    subject: item.subject, snippet: item.bodyPreview, bodyText: extractPlainText(item.body),
    receivedAt: item.receivedDateTime, internetMessageId: item.internetMessageId,
  };
}

function extractPlainText(body) {
  if (!body) return '';
  if (body.contentType === 'text') return body.content || '';
  if (body.contentType === 'html' && body.content) {
    return body.content.replace(/<[^>]+>/g, ' ');
  }
  return '';
}
