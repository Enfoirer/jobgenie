'use client';
import { useEffect, useState } from 'react';
export default function ErrorReview() {
  const [draft, setDraft] = useState({ reference: '', platform: '', version: '', start: '', end: '' });
  const [query, setQuery] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(['']);
  const [refresh, setRefresh] = useState(0);
  const cursor = history.at(-1);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    const params = new URLSearchParams(query); if (cursor) params.set('before', cursor);
    fetch(`/api/admin/errors?${params}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to load errors');
      if (!controller.signal.aborted) setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [query, cursor, refresh]);
  const apply = event => { event.preventDefault(); setData(null); setHistory(['']); setQuery(Object.fromEntries(Object.entries(draft).filter(([, value]) => value))); };
  return <div className="space-y-4" data-error-review><h1 className="text-2xl font-semibold">Error monitoring</h1>
    <form onSubmit={apply} className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-3">
      {Object.entries({ reference: 'Error reference', version: 'Exact version', start: 'Start date (UTC)', end: 'End date (UTC)' }).map(([name, label]) => <label key={name} className="text-sm">{label}<input className="mt-1 block w-full rounded border-gray-300 text-sm" name={name} type={['start', 'end'].includes(name) ? 'date' : 'text'} maxLength={64} value={draft[name]} onChange={event => setDraft({ ...draft, [name]: event.target.value })} /></label>)}
      <label className="text-sm">Platform<select name="platform" className="mt-1 block rounded border-gray-300 text-sm" value={draft.platform} onChange={event => setDraft({ ...draft, platform: event.target.value })}><option value="">All</option>{['server', 'web', 'ios'].map(value => <option key={value}>{value}</option>)}</select></label>
      <button className="self-end rounded bg-blue-600 px-4 py-2 text-white">Find errors</button>
    </form>
    <p className="text-sm text-gray-600">Records expire after 30 days. Matching reports in the same UTC minute share a reference and increment the count. Client reports are user-submitted diagnostics.</p>
    <button className="rounded border px-3 py-2" onClick={() => { setData(null); setHistory(['']); setRefresh(value => value + 1); }}>Refresh errors</button>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading errors…</p>}
    {data?.items.length === 0 && <p>No matching errors.</p>}
    {data?.items.map(item => <article key={item._id} data-error-item className="space-y-2 rounded border bg-white p-4 text-sm">
      <h2 className="break-all font-mono font-semibold">{item._id}</h2>
      <p>{item.platform} · {item.kind} · {item.method} {item.route} · HTTP {item.status || '—'}</p>
      <p>Version {item.version} · {item.environment} · Count {item.count}</p>
      {item.location && <p className="break-all">Code location {item.location}</p>}
      {item.code && <p>Error code {item.code}</p>}
      <p className="break-all">Release {item.release}</p>
      <p>First seen {item.createdAt} · Last seen {item.lastSeenAt}</p>
      {item.digest && <p>Framework digest {item.digest}</p>}
    </article>)}
    {data && <nav className="flex gap-4" aria-label="Error pages"><button disabled={history.length === 1} onClick={() => { setData(null); setHistory(value => value.slice(0, -1)); }}>Previous</button><span>Page {history.length}</span><button disabled={!data.nextCursor} onClick={() => { setData(null); setHistory(value => [...value, data.nextCursor]); }}>Next</button></nav>}
  </div>;
}
