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

export async function fetchGmailMessages(account, { limit = 10 } = {}) {
  const accessToken = await ensureGoogleAccessToken(account);
  const historyId = account?.metadata?.historyId;

  // Try incremental via historyId if present
  if (historyId) {
    try {
      const histRes = await fetch(
        `${GMAIL_API_BASE}/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded&maxResults=${limit}`,
        { headers: buildAuthorizationHeader(accessToken) }
      );

      if (histRes.ok) {
        const historyData = await histRes.json();
        const addedIds = new Set();
        (historyData.history || []).forEach((h) => {
          (h.messagesAdded || []).forEach((m) => {
            if (m?.message?.id) {
              addedIds.add(m.message.id);
            }
          });
        });

        const ids = Array.from(addedIds);
        if (ids.length === 0) {
          return { messages: [], newHistoryId: historyData.historyId || historyId };
        }

        const messages = await Promise.all(
          ids.map(async (id) => {
            const msgRes = await fetch(
              `${GMAIL_API_BASE}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: buildAuthorizationHeader(accessToken) }
            );

            if (!msgRes.ok) {
              const text = await msgRes.text();
              throw new Error(
                `Failed to fetch Gmail message ${id}: ${msgRes.status} ${msgRes.statusText} - ${text}`
              );
            }

            const msgData = await msgRes.json();
            const headers = parseGmailHeaders(msgData.payload?.headers);

            return {
              provider: 'gmail',
              id: msgData.id,
              threadId: msgData.threadId,
              from: headers.from,
              to: headers.to,
              subject: headers.subject,
              snippet: msgData.snippet,
              internalDate: msgData.internalDate,
              historyId: msgData.historyId,
              receivedAt: headers.date || new Date(Number(msgData.internalDate)),
            };
          })
        );

        const newHistoryId =
          historyData.historyId ||
          (historyData.history && historyData.history.length > 0
            ? historyData.history[historyData.history.length - 1].id
            : historyId);

        return { messages, newHistoryId };
      }
    } catch (e) {
      console.warn('Gmail history fetch failed, falling back to latest list:', e);
    }
  }

  // Fallback: fetch latest messages
  const listRes = await fetch(
    `${GMAIL_API_BASE}/users/me/messages?maxResults=${limit}&labelIds=INBOX`,
    { headers: buildAuthorizationHeader(accessToken) }
  );

  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(
      `Failed to list Gmail messages: ${listRes.status} ${listRes.statusText} - ${text}`
    );
  }

  const listData = await listRes.json();
  if (!listData.messages || listData.messages.length === 0) {
    return { messages: [], newHistoryId: historyId };
  }

  // Fetch message metadata in parallel
  const messages = await Promise.all(
    listData.messages.map(async ({ id }) => {
      const msgRes = await fetch(
        `${GMAIL_API_BASE}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: buildAuthorizationHeader(accessToken) }
      );

      if (!msgRes.ok) {
        const text = await msgRes.text();
        throw new Error(
          `Failed to fetch Gmail message ${id}: ${msgRes.status} ${msgRes.statusText} - ${text}`
        );
      }

      const msgData = await msgRes.json();
      const headers = parseGmailHeaders(msgData.payload?.headers);

      return {
        provider: 'gmail',
        id: msgData.id,
        threadId: msgData.threadId,
        from: headers.from,
        to: headers.to,
        subject: headers.subject,
        snippet: msgData.snippet,
        internalDate: msgData.internalDate,
        historyId: msgData.historyId,
        receivedAt: headers.date || new Date(Number(msgData.internalDate)),
      };
    })
  );

  return { messages, newHistoryId: historyId };
}
