import { normalizeSyncLimit } from './syncOptions.js';

// lib/mail/gmail.js
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

function buildAuthorizationHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function refreshGoogleToken(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
  }

  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('refresh_token', refreshToken);
  params.set('grant_type', 'refresh_token');

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to refresh Google token: ${res.status} ${res.statusText} - ${text}`
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

async function ensureGoogleAccessToken(account) {
  const now = new Date();
  const needsRefresh =
    account.expiresAt && new Date(account.expiresAt).getTime() <= now.getTime();

  if (needsRefresh) {
    if (!account.refreshToken) {
      throw new Error('Google access token expired and no refresh token present');
    }
    const refreshed = await refreshGoogleToken(account.refreshToken);
    account.accessToken = refreshed.accessToken;
    account.expiresAt = refreshed.expiresAt;
    account.scope = refreshed.scope || account.scope;
    if (typeof account.save === 'function') {
      await account.save();
    }
  }

  return account.accessToken;
}

function parseGmailHeaders(headers = []) {
  const map = {};
  headers.forEach((h) => {
    map[h.name.toLowerCase()] = h.value;
  });
  return {
    from: map['from'],
    to: map['to'],
    subject: map['subject'],
    date: map['date'],
  };
}

// A history page counts change records, not individual emails. Keep unconsumed
// IDs as well as the next page token, and only publish a new historyId at EOF.
export async function fetchGmailMessages(account, { limit = 10 } = {}) {
  limit = normalizeSyncLimit(limit);
  const accessToken = await ensureGoogleAccessToken(account);
  const metadata = account.metadata || {};
  let state = metadata.gmailSync ? structuredClone(metadata.gmailSync) : null;
  let pagesFetched = 0;
  let unavailable = 0;
  let examined = 0;
  let cursorResets = 0;
  let completedHistoryId;
  const messages = [];
  const seen = new Set();
  const visitedPages = new Set();

  const startFullSync = async () => {
    const response = await gmailJSON(`${GMAIL_API_BASE}/users/me/profile`, accessToken);
    if (!/^\d+$/.test(response.historyId)) throw new Error('Gmail profile has no valid historyId');
    return { mode: 'list', baselineHistoryId: response.historyId, pageToken: null, loaded: false, remainingIds: [] };
  };
  if (!state) {
    state = metadata.historyId
      ? { mode: 'history', startHistoryId: metadata.historyId, pageToken: null, loaded: false, remainingIds: [] }
      : await startFullSync();
  }

  while (state && examined < limit) {
    if (!state.loaded) {
      if (pagesFetched >= 10) break; // Bound empty/duplicate-only provider pages.
      const pageKey = JSON.stringify([state.mode, state.startHistoryId, state.pageToken]);
      if (visitedPages.has(pageKey)) throw new Error('Gmail repeated a pagination token');
      visitedPages.add(pageKey);
      const params = new URLSearchParams({ maxResults: String(limit) });
      if (state.pageToken) params.set('pageToken', state.pageToken);
      if (state.mode === 'history') {
        params.set('startHistoryId', state.startHistoryId);
        params.set('historyTypes', 'messageAdded');
      } else {
        params.set('labelIds', 'INBOX');
      }
      let page;
      try {
        page = await gmailJSON(`${GMAIL_API_BASE}/users/me/${state.mode === 'history' ? 'history' : 'messages'}?${params}`, accessToken);
      } catch (error) {
        if (state.mode === 'history' && error.status === 404 && cursorResets === 0) {
          state = await startFullSync();
          cursorResets++;
          continue;
        }
        if (state.pageToken && [400, 410].includes(error.status) && cursorResets === 0) {
          // Restart safely from the committed cursor, not from the newest mail.
          state = state.mode === 'history'
            ? { mode: 'history', startHistoryId: state.startHistoryId, pageToken: null, loaded: false, remainingIds: [] }
            : await startFullSync();
          visitedPages.clear();
          cursorResets++;
          continue;
        }
        throw error;
      }
      pagesFetched++;
      const ids = state.mode === 'history'
        ? (page.history || []).flatMap((h) => (h.messagesAdded || []).map((m) => m.message?.id))
        : (page.messages || []).map((m) => m.id);
      if (ids.some((id) => typeof id !== 'string' || !id)) throw new Error('Gmail page has an invalid message ID');
      state.remainingIds = [...new Set(ids)];
      state.pageToken = page.nextPageToken || null;
      state.loaded = true;
      if (state.mode === 'history') {
        if (!/^\d+$/.test(page.historyId)) throw new Error('Gmail history page has no valid historyId');
        state.completionHistoryId = page.historyId;
      }
    }

    while (state.remainingIds.length && examined < limit) {
      const id = state.remainingIds.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      examined++;
      try {
        messages.push(await fetchGmailMessage(id, accessToken));
      } catch (error) {
        // Mail may be deleted between listing its ID and fetching its body.
        if (error.status !== 404) throw error;
        unavailable++;
      }
    }
    if (!state.remainingIds.length) {
      if (state.pageToken) state.loaded = false;
      else {
        completedHistoryId = state.mode === 'history' ? state.completionHistoryId : state.baselineHistoryId;
        state = null;
      }
    }
  }
  return {
    messages, pagesFetched, unavailable, cursorResets, hasMore: state !== null,
    cursor: { gmailSync: state, ...(completedHistoryId ? { historyId: completedHistoryId } : {}) },
  };
}

async function gmailJSON(url, accessToken) {
  const response = await fetch(url, { headers: buildAuthorizationHeader(accessToken) });
  if (!response.ok) throw Object.assign(new Error(`Gmail request failed (${response.status})`), { status: response.status });
  return response.json();
}

async function fetchGmailMessage(id, accessToken) {
  const data = await gmailJSON(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(id)}?format=full`, accessToken);
  if (data.id !== id) throw new Error('Gmail message identity does not match its requested ID');
  const headers = parseGmailHeaders(data.payload?.headers);
  return {
    provider: 'gmail', id: data.id, threadId: data.threadId,
    from: headers.from, to: headers.to, subject: headers.subject,
    snippet: data.snippet, bodyText: extractPlainText(data.payload),
    internalDate: data.internalDate, historyId: data.historyId,
    receivedAt: headers.date || new Date(Number(data.internalDate)),
  };
}

function extractPlainText(payload) {
  // Traverse parts to find text/plain or fallback to text/html
  const stack = [payload];
  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body?.data) {
      return stripHtml(decodeBase64(part.body.data));
    }
    if (Array.isArray(part.parts)) {
      part.parts.forEach((p) => stack.push(p));
    }
  }
  return '';
}

function decodeBase64(data) {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) {
    return '';
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ');
}
