'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const buttonClass = 'rounded-md border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50';
const stages = { ingest: 'Mail download failed. Check the connection and try Sync now.', process: 'Some messages could not be processed. Use Retry failed.', queue: 'Processing queue unavailable. Try again later.', summary: 'Queue counts unavailable. Refresh status.', result: 'Could not save this result. Refresh status.' };

function Counts({ result }) {
  return <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
    {[['Fetched', 'totalFetched'], ['Saved', 'stored'], ['Succeeded', 'processed'], ['Failed', 'failed'], ['Awaiting review', 'pendingReview'], ['Applied', 'applied'], ['Older history', 'historical'], ['Irrelevant', 'irrelevant'], ['Duplicates', 'skipped']].map(([label, key]) => (
      <div key={key}><dt className="inline text-gray-500">{label}: </dt><dd className="inline font-medium">{result[key] ?? 0}</dd></div>
    ))}
  </dl>;
}

export default function MailSyncPanel({ accountVersion = '' }) {
  const [accounts, setAccounts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/mail/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load sync status. Please refresh.');
      const data = await response.json();
      setAccounts(data.accounts);
    } catch (err) { setError(err.message); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(timer);
  }, [load, accountVersion]);

  async function run(action, accountId) {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/mail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(accountId ? { accountId } : {}) }),
      });
      if (!response.ok) throw new Error('The request did not complete. Refresh status before trying again.');
      setResult(await response.json());
    } catch (err) { setError(err.message); }
    finally { await load(); setBusy(false); }
  }

  return <section className="mt-6 rounded-lg border bg-white p-4 shadow-sm" aria-labelledby="mail-sync-title" aria-busy={busy}>
    <h2 id="mail-sync-title" className="text-lg font-medium">Mail sync</h2>
    <p className="mt-1 text-sm text-gray-500">Each sync fetches up to 10 emails per account and processes up to 50 saved messages. Continue syncing while more mail remains. Retry processes up to 50 failed messages per account without downloading mail.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button className={buttonClass} disabled={busy || !accounts?.length} onClick={() => run('sync')}>Sync now</button>
      <button className={buttonClass} disabled={busy || !accounts?.some((a) => a.backlog.failed)} onClick={() => run('retry')}>Retry failed</button>
      <button className={buttonClass} disabled={busy || refreshing} onClick={() => { setError(''); load(); }}>Refresh status</button>
      <Link href="/dashboard/pending" className={buttonClass}>Review pending emails</Link>
    </div>
    {busy && <p role="status" className="mt-3 text-sm">Processing emails…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {result && <div role="status" className="mt-4 rounded bg-blue-50 p-3">
      <p className="font-medium">{result.errorCount ? 'Completed with errors' : 'Sync completed'}</p>
      <Counts result={result} />
      {[...new Set((result.errors || []).map((e) => e.stage))].map((stage) => <p key={stage} className="mt-1 text-sm text-red-700">{stages[stage] || 'An error occurred. Refresh status.'}</p>)}
    </div>}
    {accounts === null ? <p className="mt-3 text-sm">Loading sync status…</p> : accounts.length === 0 ? <p className="mt-3 text-sm text-gray-500">Connect an email account to start syncing.</p> : accounts.map((account) => <article key={account.id} className="mt-4 border-t pt-3">
      <h3 className="break-all font-medium">{account.emailAddress} <span className="text-xs uppercase text-gray-500">{account.provider}</span></h3>
      <p className="mt-1 text-sm">Queue: {account.backlog.pending} waiting · {account.backlog.processing} processing · {account.backlog.failed} failed · {account.backlog.pendingReview} awaiting review</p>
      {account.hasMore && <p className="mt-1 text-sm text-blue-700">More mail remains. Continue sync to fetch the next batch.</p>}
      <div className="mt-2 flex gap-2">
        <button className={buttonClass} disabled={busy} onClick={() => run('sync', account.id)}>{account.hasMore ? 'Continue sync' : 'Sync account'}</button>
        <button className={buttonClass} disabled={busy || !account.backlog.failed} onClick={() => run('retry', account.id)}>Retry account failures</button>
      </div>
      {account.lastSync ? <div className="mt-3 text-sm">
        <p className="text-gray-500">Last {account.lastSync.action === 'retry' ? 'retry' : 'sync'}: {new Date(account.lastSync.finishedAt).toLocaleString()} · {account.lastSync.errorCount ? 'Completed with errors' : 'Completed'}</p>
        <Counts result={account.lastSync} />
        {(account.lastSync.errorStages || []).map((stage) => <p key={stage} className="mt-1 text-red-700">{stages[stage] || 'An error occurred.'}</p>)}
      </div> : <p className="mt-2 text-sm text-gray-500">No saved sync result yet.</p>}
      {!!account.failures.length && <details className="mt-3 text-sm"><summary className="cursor-pointer">Failed emails (latest {account.failures.length} of {account.backlog.failed})</summary>
        <ul className="mt-2 space-y-1">{account.failures.map((mail) => <li key={mail.id} className="break-words">{mail.subject} · {mail.attempts} attempts · {new Date(mail.updatedAt).toLocaleString()}</li>)}</ul>
      </details>}
    </article>)}
  </section>;
}
