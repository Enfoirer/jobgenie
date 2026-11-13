'use client';
import { useEffect, useRef, useState } from 'react';

export default function FeedbackReview() {
  const [filters, setFilters] = useState({ platform: '', version: '', start: '', end: '', source: '', missingVersion: false });
  const [query, setQuery] = useState({});
  const [cursors, setCursors] = useState(['']);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const request = useRef(null);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setData(null); setError('');
    const params = new URLSearchParams(query);
    if (cursor) params.set('cursor', cursor);
    fetch(`/api/admin/feedback?${params}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'Administrator access required. Sign in with an authorized account.' : result.error || 'Unable to load feedback.');
      if (!controller.signal.aborted) setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, cursor, refresh]);
  function apply(event) {
    event.preventDefault(); request.current?.abort(); setData(null); setCursors(['']);
    const next = Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && key !== 'missingVersion'));
    if (filters.missingVersion) { delete next.version; next.missingVersion = '1'; }
    setQuery(next);
  }
  const update = event => setFilters(previous => ({ ...previous, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const inputClass = 'mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm';
  return <div className="space-y-5" data-feedback-review>
    <h1 className="text-2xl font-semibold">Product feedback</h1>
    <form onSubmit={apply} className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
      <label className="text-sm">Platform<select name="platform" value={filters.platform} onChange={update} className={inputClass}>
        <option value="">All platforms</option><option value="ios">iOS</option><option value="web">Web</option><option value="unknown">Unknown</option>
      </select></label>
      <label className="text-sm">Exact version<input name="version" value={filters.version} onChange={update} disabled={filters.missingVersion} maxLength={40} className={inputClass} /></label>
      <label className="text-sm">Start date (UTC)<input name="start" type="date" value={filters.start} onChange={update} max={filters.end || undefined} className={inputClass} /></label>
      <label className="text-sm">End date (UTC)<input name="end" type="date" value={filters.end} onChange={update} min={filters.start || undefined} className={inputClass} /></label>
      <label className="text-sm">Response source<select name="source" value={filters.source} onChange={update} className={inputClass}>
        <option value="">All sources</option><option value="manual">Manual</option><option value="prompt">Automatic invitation</option>
      </select></label>
      <div className="flex items-end"><button className="rounded bg-blue-600 px-4 py-2 text-white">Apply filters</button></div>
      <label className="flex items-center gap-2 text-sm sm:col-span-3"><input name="missingVersion" type="checkbox" checked={filters.missingVersion} onChange={update} />Missing version only</label>
    </form>
    <p className="text-sm text-gray-600">Dates include the full UTC calendar day. Scores use a five-star scale. Manual and invited responses represent different samples.</p>
    <button disabled={loading} onClick={() => { request.current?.abort(); setData(null); setCursors(['']); setRefresh(value => value + 1); }} className="rounded border px-3 py-2 text-sm">Refresh feedback</button>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {loading && <p role="status">Loading feedback…</p>}
    {data && <>
      <p className="text-sm" data-feedback-total>{data.total} {data.total === 1 ? 'matching response' : 'matching responses'}</p>
      {data.items.length === 0 && <p>No feedback matches these filters.</p>}
      <div className="space-y-3">{data.items.map((item, index) => <article key={`${item.createdAt}-${index}`} className="rounded-lg border bg-white p-4" data-feedback-item>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>Overall {item.overall}/5</span><span>Recommendation {item.recommendation}/5</span>
          <span>{item.platform === 'ios' ? 'iOS' : item.platform === 'web' ? 'Web' : 'Unknown platform'}</span>
          <span>Version {item.appVersion}</span><span>{item.source === 'prompt' ? 'Automatic invitation' : item.source === 'manual' ? 'Manual' : 'Unknown source'}</span>
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toISOString().replace('T', ' ').replace('Z', ' UTC')}</time>
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words text-gray-800">{item.comment || 'No written comment.'}</p>
        <p className="mt-3 break-words text-xs text-gray-500">Locale {item.locale} · Campaign {item.campaign}</p>
      </article>)}</div>
      <nav aria-label="Feedback pages" className="flex items-center gap-4">
        <button disabled={loading || cursors.length === 1} onClick={() => { request.current?.abort(); setData(null); setCursors(previous => previous.slice(0, -1)); }} className="rounded border px-3 py-2 disabled:opacity-50">Previous</button>
        <span>Page {cursors.length}</span>
        <button disabled={loading || !data.nextCursor} onClick={() => { request.current?.abort(); setData(null); setCursors(previous => [...previous, data.nextCursor]); }} className="rounded border px-3 py-2 disabled:opacity-50">Next</button>
      </nav>
    </>}
  </div>;
}
