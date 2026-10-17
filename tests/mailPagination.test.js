import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchGmailMessages } from '../lib/mail/gmail.js';
import { fetchOutlookMessages } from '../lib/mail/outlook.js';
import { normalizeSyncLimit, parseMailSyncOptions } from '../lib/mail/syncOptions.js';

const account = (metadata = {}) => ({ accessToken: 'test-only', metadata });
const commit = (mailAccount, batch) => { Object.assign(mailAccount.metadata, batch.cursor); };
const gmailBody = (id) => ({
  id, historyId: '999999', internalDate: '1792198800000',
  payload: { mimeType: 'text/plain', body: { data: Buffer.from(`Body ${id}`).toString('base64url') } },
});
const outlookBody = (id, time = '2026-10-17T01:00:00Z') => ({
  id, subject: id, receivedDateTime: time, body: { contentType: 'text', content: `Body ${id}` },
});
const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$skiptoken=opaque%2Btoken&$top=2';
function mockGmail(t, handler) {
  return t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    const detail = url.pathname.match(/\/messages\/([^/]+)$/);
    if (detail) return Response.json(gmailBody(decodeURIComponent(detail[1])));
    return handler(url);
  });
}

test('sync limit defaults and legal boundaries are shared and explicit', () => {
  assert.equal(normalizeSyncLimit(), 10);
  for (const value of [1, 10, 50, '1', '50']) assert.equal(normalizeSyncLimit(value), Number(value));
  for (const value of [null, '', ' ', 0, -1, 51, 1.5, '1.5', '1e1', '0x10', 'abc', NaN, Infinity, true, '999999999999999999999']) {
    assert.throws(() => normalizeSyncLimit(value), { status: 400 });
  }
  assert.deepEqual(parseMailSyncOptions(new URLSearchParams()), { limit: 10 });
  assert.deepEqual(parseMailSyncOptions(new URLSearchParams('provider=outlook&limit=50')), { limit: 50, provider: 'outlook' });
  for (const query of ['limit=', 'limit=0', 'limit=51', 'limit=10&limit=20', 'provider=unknown', 'provider=gmail&provider=outlook']) {
    assert.throws(() => parseMailSyncOptions(new URLSearchParams(query)), { status: 400 });
  }
});

test('Gmail resumes multi-message history records and page tokens across invocations', async (t) => {
  const requests = [];
  mockGmail(t, (url) => {
    assert.equal(url.searchParams.get('startHistoryId'), '100');
    requests.push(url.searchParams.get('pageToken'));
    return Response.json(url.searchParams.has('pageToken')
      ? { history: [{ messagesAdded: [{ message: { id: 'd' } }] }], historyId: '300' }
      : { history: [{ messagesAdded: ['a', 'b', 'c'].map((id) => ({ message: { id } })) }], nextPageToken: 'page-2', historyId: '300' });
  });
  const mailAccount = account({ historyId: '100' });
  const first = await fetchGmailMessages(mailAccount, { limit: 2 });
  assert.deepEqual(first.messages.map((m) => m.id), ['a', 'b']);
  assert.equal(first.hasMore, true);
  commit(mailAccount, first);
  assert.equal(mailAccount.metadata.historyId, '100'); // Message historyId=999999 must not advance this.
  const second = await fetchGmailMessages(mailAccount, { limit: 2 });
  assert.deepEqual(second.messages.map((m) => m.id), ['c', 'd']);
  assert.equal(second.hasMore, false);
  commit(mailAccount, second);
  assert.equal(mailAccount.metadata.historyId, '300');
  assert.equal(mailAccount.metadata.gmailSync, null);
  assert.deepEqual(requests, [null, 'page-2']);
});

test('Gmail follows several short pages within one sync and deduplicates page IDs', async (t) => {
  mockGmail(t, (url) => {
    const page = Number(url.searchParams.get('pageToken') || 1);
    return Response.json({
      history: [{ messagesAdded: [{ message: { id: 'same' } }, { message: { id: `mail-${page}` } }] }],
      historyId: '9007199254740993', ...(page < 3 ? { nextPageToken: String(page + 1) } : {}),
    });
  });
  const batch = await fetchGmailMessages(account({ historyId: '100' }), { limit: 5 });
  assert.deepEqual(batch.messages.map((m) => m.id), ['same', 'mail-1', 'mail-2', 'mail-3']);
  assert.equal(batch.pagesFetched, 3);
  assert.equal(batch.cursor.historyId, '9007199254740993');
});

test('Gmail initial full listing keeps a pre-scan baseline instead of newest message history', async (t) => {
  const calls = [];
  mockGmail(t, (url) => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/profile')) return Response.json({ historyId: '200' });
    if (url.pathname.endsWith('/history')) {
      assert.equal(url.searchParams.get('startHistoryId'), '200');
      return Response.json({ history: [{ messagesAdded: [{ message: { id: 'arrived-during-scan' } }] }], historyId: '400' });
    }
    return Response.json(url.searchParams.has('pageToken')
      ? { messages: [{ id: 'old-2' }] }
      : { messages: [{ id: 'old-1' }], nextPageToken: 'older' });
  });
  const mailAccount = account();
  const first = await fetchGmailMessages(mailAccount, { limit: 1 });
  commit(mailAccount, first);
  assert.equal(mailAccount.metadata.historyId, undefined);
  commit(mailAccount, await fetchGmailMessages(mailAccount, { limit: 1 }));
  assert.equal(mailAccount.metadata.historyId, '200');
  const incremental = await fetchGmailMessages(mailAccount, { limit: 1 });
  assert.equal(incremental.messages[0].id, 'arrived-during-scan');
  assert.equal(calls.filter((path) => path.endsWith('/profile')).length, 1);
});

test('Gmail recovers an expired history cursor using paginated full sync', async (t) => {
  mockGmail(t, (url) => {
    if (url.pathname.endsWith('/history')) return new Response('{}', { status: 404 });
    if (url.pathname.endsWith('/profile')) return Response.json({ historyId: '500' });
    return Response.json({ messages: [{ id: 'recover' }], nextPageToken: 'more' });
  });
  const batch = await fetchGmailMessages(account({ historyId: 'expired' }), { limit: 1 });
  assert.equal(batch.messages[0].id, 'recover');
  assert.equal(batch.cursor.gmailSync.mode, 'list');
  assert.equal(batch.cursor.historyId, undefined);
  assert.equal(batch.cursorResets, 1);
});

test('Gmail transient/auth failures do not fall back or mutate pagination state', async (t) => {
  const mailAccount = account({ historyId: '100' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}', { status: 503 }); });
  await assert.rejects(fetchGmailMessages(mailAccount), /503/);
  assert.equal(calls, 1);
  assert.deepEqual(mailAccount.metadata, { historyId: '100' });
});

test('Gmail detail failures preserve the entire original continuation for retry', async (t) => {
  const state = { mode: 'history', startHistoryId: '100', remainingIds: ['a', 'b'], loaded: true, pageToken: null, completionHistoryId: '300' };
  const mailAccount = account({ historyId: '100', gmailSync: state });
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('/messages/b?')
    ? new Response('{}', { status: 503 }) : Response.json(gmailBody('a')));
  await assert.rejects(fetchGmailMessages(mailAccount), /503/);
  assert.deepEqual(mailAccount.metadata.gmailSync.remainingIds, ['a', 'b']);
});

test('deleted Gmail details are counted without blocking the rest of a page', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/history')) return Response.json({ history: [{ messagesAdded: ['deleted', 'live'].map((id) => ({ message: { id } })) }], historyId: '300' });
    if (url.pathname.endsWith('/deleted')) return new Response('{}', { status: 404 });
    return Response.json(gmailBody('live'));
  });
  const batch = await fetchGmailMessages(account({ historyId: '100' }), { limit: 2 });
  assert.equal(batch.unavailable, 1);
  assert.equal(batch.messages[0].id, 'live');
  assert.equal(batch.cursor.historyId, '300');
});

test('Gmail bounds empty-page traversal and preserves its next page', async (t) => {
  let page = 0;
  mockGmail(t, () => Response.json({ historyId: '300', nextPageToken: `page-${++page}` }));
  const batch = await fetchGmailMessages(account({ historyId: '100' }));
  assert.equal(batch.pagesFetched, 10);
  assert.equal(batch.hasMore, true);
  assert.equal(batch.cursor.gmailSync.pageToken, 'page-10');
});

test('Gmail restarts an invalid page token from its committed history cursor', async (t) => {
  mockGmail(t, (url) => url.searchParams.has('pageToken')
    ? new Response('{}', { status: 400 })
    : Response.json({ history: [{ messagesAdded: [{ message: { id: 'replay' } }] }], historyId: '300' }));
  const batch = await fetchGmailMessages(account({ historyId: '100', gmailSync: {
    mode: 'history', startHistoryId: '100', pageToken: 'expired-token', loaded: false, remainingIds: [],
  } }));
  assert.equal(batch.cursorResets, 1);
  assert.equal(batch.messages[0].id, 'replay');
});

test('Outlook follows opaque nextLinks and preserves overflowing messages if limit changes', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    calls.push(String(input));
    return Response.json(String(input) === nextLink
      ? { value: [outlookBody('c'), outlookBody('d')] }
      : { value: [outlookBody('a'), outlookBody('b')], '@odata.nextLink': nextLink });
  });
  const mailAccount = account({ lastReceivedAt: new Date('2026-10-16T00:00:00Z') });
  const first = await fetchOutlookMessages(mailAccount, { limit: 2 });
  commit(mailAccount, first);
  assert.equal(mailAccount.metadata.lastReceivedAt.toISOString(), '2026-10-16T00:00:00.000Z');
  const second = await fetchOutlookMessages(mailAccount, { limit: 1 });
  assert.deepEqual(second.messages.map((m) => m.id), ['c']);
  commit(mailAccount, second);
  const third = await fetchOutlookMessages(mailAccount, { limit: 1 });
  assert.deepEqual(third.messages.map((m) => m.id), ['d']);
  assert.equal(third.hasMore, false);
  assert.equal(third.cursor.lastReceivedAt.toISOString(), '2026-10-17T01:00:00.000Z');
  assert.equal(calls.length, 2);
  assert.equal(calls[1], nextLink);
});

test('Outlook follows short pages within one invocation, including tied timestamps', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => Response.json(String(input) === nextLink
    ? { value: [outlookBody('b')] }
    : { value: [outlookBody('a')], '@odata.nextLink': nextLink }));
  const batch = await fetchOutlookMessages(account(), { limit: 10 });
  assert.deepEqual(batch.messages.map((m) => m.id), ['a', 'b']);
  assert.equal(batch.pagesFetched, 2);
  assert.equal(batch.hasMore, false);
});

test('Outlook next scan overlaps the completed boundary and catches later arrivals', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    urls.push(new URL(input));
    return Response.json({ value: [outlookBody(urls.length === 1 ? 'original' : 'new', urls.length === 1 ? '2026-10-16T01:00:00Z' : '2026-10-16T02:00:00Z')] });
  });
  const mailAccount = account();
  commit(mailAccount, await fetchOutlookMessages(mailAccount));
  const second = await fetchOutlookMessages(mailAccount);
  assert.equal(second.messages[0].id, 'new');
  assert.match(urls[1].searchParams.get('$filter'), /receivedDateTime ge 2026-10-16T01:00:00.000Z/);
  assert.match(urls[1].searchParams.get('$filter'), /receivedDateTime le /);
});

test('Outlook page failure leaves the original continuation intact', async (t) => {
  const mailAccount = account({ outlookSync: { nextLink, remainingMessages: [], isContinuation: true } });
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  await assert.rejects(fetchOutlookMessages(mailAccount), /503/);
  assert.equal(mailAccount.metadata.outlookSync.nextLink, nextLink);
});

test('Outlook never forwards a bearer token to an unexpected pagination host', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    requests.push(String(input));
    return Response.json({ value: [], '@odata.nextLink': 'https://example.test/steal' });
  });
  await assert.rejects(fetchOutlookMessages(account()), /Invalid Outlook pagination link/);
  assert.equal(requests.length, 1);
});

test('Outlook restarts expired continuation links from the last completed watermark', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    if (String(input) === nextLink) return new Response('{}', { status: 410 });
    assert.match(new URL(input).searchParams.get('$filter'), /receivedDateTime ge 2026-10-16/);
    return Response.json({ value: [outlookBody('recovered')] });
  });
  const batch = await fetchOutlookMessages(account({
    lastReceivedAt: new Date('2026-10-16T00:00:00Z'),
    outlookSync: { nextLink, remainingMessages: [], isContinuation: true },
  }));
  assert.equal(batch.cursorResets, 1);
  assert.equal(batch.messages[0].id, 'recovered');
});

test('Outlook bounds empty pages and detects repeated nextLinks', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ value: [], '@odata.nextLink': nextLink }));
  await assert.rejects(fetchOutlookMessages(account()), /repeated a pagination link/);
});
