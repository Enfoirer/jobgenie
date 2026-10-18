'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, dateInZone } from '@/lib/analytics/range';

const LABELS = { applied: 'Applied', interviewing: 'Interview / assessment', offer: 'Offer', rejected: 'Rejected' };
const COLORS = { applied: 'bg-blue-500', interviewing: 'bg-amber-500', offer: 'bg-green-500', rejected: 'bg-red-500', applications: 'bg-indigo-500' };
const percent = (value) => value === null ? '—' : `${value.toFixed(1)}%`;
const formatDate = (value, timeZone) => value ? new Date(value).toLocaleDateString([], { timeZone, year: 'numeric', month: 'short', day: 'numeric' }) : '—';

function RangeForm({ initial, onApply, loading }) {
  const [mode, setMode] = useState(initial.days || 'custom');
  const [zone, setZone] = useState(initial.timeZone);
  const [start, setStart] = useState(initial.start || addDays(dateInZone(Date.now(), initial.timeZone), -29));
  const [end, setEnd] = useState(initial.end || dateInZone(Date.now(), initial.timeZone));
  let today;
  try { today = dateInZone(Date.now(), zone); } catch { /* API validates a typed zone. */ }
  return <form onSubmit={(event) => { event.preventDefault(); onApply(mode === 'custom' ? { start, end, timeZone: zone } : { days: mode, timeZone: zone }); }}
    className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
    <label className="text-sm text-gray-700">Date range
      <select name="range" value={mode} onChange={(event) => setMode(event.target.value)} className="mt-1 block w-full rounded border-gray-300 text-sm">
        {[7, 30, 90, 365].map((days) => <option key={days} value={String(days)}>Last {days} days</option>)}
        <option value="custom">Custom dates</option>
      </select>
    </label>
    {mode === 'custom' && <>
      <label className="text-sm text-gray-700">Start date<input name="start" type="date" value={start} required min="1970-01-01" max={today} onChange={(event) => setStart(event.target.value)} className="mt-1 block rounded border-gray-300 text-sm" /></label>
      <label className="text-sm text-gray-700">End date<input name="end" type="date" value={end} required min={start || '1970-01-01'} max={today} onChange={(event) => setEnd(event.target.value)} className="mt-1 block rounded border-gray-300 text-sm" /></label>
    </>}
    <label className="min-w-0 text-sm text-gray-700">Time zone
      <input name="timeZone" list="analytics-zones" required value={zone} onChange={(event) => setZone(event.target.value)} className="mt-1 block w-56 max-w-full rounded border-gray-300 text-sm" />
      <datalist id="analytics-zones">{[...new Set([initial.timeZone, 'UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney'])].map((value) => <option key={value} value={value} />)}</datalist>
    </label>
    <button disabled={loading} className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">Apply range</button>
    <p className="w-full text-xs text-gray-500">Inclusive local calendar dates, up to 366 days. Today includes only events up to now.</p>
  </form>;
}

function Timeline({ timeline }) {
  const [mode, setMode] = useState('events');
  const [statuses, setStatuses] = useState(Object.keys(LABELS));
  const selected = mode === 'applications' ? ['applications'] : statuses;
  const entries = Object.entries(timeline);
  const sum = (row) => selected.reduce((total, status) => total + row[status], 0);
  const max = Math.max(1, ...entries.map(([, row]) => sum(row)));
  return <section className="rounded-lg border bg-white p-4 sm:p-6" aria-label="Activity trend">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Activity trend</h2><p className="mt-1 text-sm text-gray-500">Activity for all applications in this period. Status events count records; conversion rates count distinct applications.</p></div>
      <label className="text-sm">Chart metric<select name="chartMetric" value={mode} onChange={(event) => setMode(event.target.value)} className="ml-2 rounded border-gray-300 text-sm"><option value="events">Status events</option><option value="applications">New applications</option></select></label>
    </div>
    {mode === 'events' && <div className="mt-3 flex flex-wrap gap-2">{Object.entries(LABELS).map(([status, label]) => <button key={status} aria-pressed={statuses.includes(status)}
      onClick={() => setStatuses((previous) => previous.includes(status) ? previous.filter((item) => item !== status) : [...previous, status])}
      className={`rounded border px-2 py-1 text-xs ${statuses.includes(status) ? `${COLORS[status]} text-white` : 'bg-white text-gray-700'}`}>{label}</button>)}</div>}
    <p className="mt-2 text-xs text-gray-500">Chart controls affect only this chart. Scroll horizontally for additional days.</p>
    <div className="mt-4 overflow-x-auto rounded border p-3" tabIndex={0} aria-label="Daily activity chart">
      <div className="flex items-end gap-2" style={{ width: `${entries.length * 40}px`, minWidth: '100%' }}>
        {entries.map(([day, row]) => <div key={day} className="min-w-8 flex-1 text-center" aria-label={`${day}: ${sum(row)}`}>
          <div className="flex h-52 flex-col justify-end"><span className="text-xs text-gray-600">{sum(row) || ''}</span>
            {selected.map((status) => row[status] > 0 && <div key={status} className={`${COLORS[status]} mx-1 shrink-0 rounded-sm`} style={{ height: `${row[status] / max * 180}px` }} title={`${day} · ${LABELS[status] || 'New applications'}: ${row[status]}`} />)}
          </div><div className="mt-2 text-[10px] text-gray-500">{day.slice(5)}</div>
        </div>)}
      </div>
    </div>
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-blue-700">Daily counts table</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Date', 'New applications', ...Object.values(LABELS)].map((label) => <th key={label} className="whitespace-nowrap p-2">{label}</th>)}</tr></thead>
        <tbody>{entries.map(([day, row]) => <tr key={day} data-stats-day={day} className="border-t"><th className="whitespace-nowrap p-2 font-normal">{day}</th>{['applications', ...Object.keys(LABELS)].map((key) => <td key={key} className="p-2">{row[key]}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </section>;
}

export default function AnalyticsPage() {
  const [query, setQuery] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const pending = useRef(null);
  useEffect(() => { setQuery({ days: '30', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); }, []);
  const reload = useCallback(async () => {
    if (!query) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/stats?${new URLSearchParams(query)}`, { signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load analytics');
      if (!controller.signal.aborted) { setData(result); setError(''); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [query]);
  useEffect(() => {
    reload();
    const refresh = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh); window.addEventListener('jobgenie:schedule-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { pending.current?.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('jobgenie:schedule-changed', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [reload]);
  const pages = Math.max(1, Math.ceil((data?.cohort.total || 0) / 20)), activePage = Math.min(page, pages - 1);
  return <div className="space-y-6" data-analytics-ready={!loading && !!data}>
    <div className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-gray-900">Application Analytics</h1><p className="mt-1 text-sm text-gray-600">Current status, historical progression and daily activity.</p></div>
      <button onClick={reload} disabled={loading} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh analytics'}</button></div>
    {query && <RangeForm initial={query} loading={loading} onApply={(next) => { setData(null); setPage(0); setQuery(next); }} />}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}{data && ' Displayed results may be out of date.'}</p>}
    {!data && <p className="py-6 text-sm text-gray-500">{loading ? 'Loading analytics...' : 'Use Apply range or Refresh analytics to retry.'}</p>}
    {data && <>
      <p data-stats-range className="text-sm text-gray-600">{data.range.start} through {data.range.end} · {data.range.timeZone} · Observed through {new Date(data.range.observedThrough).toLocaleString([], { timeZone: data.range.timeZone })}</p>
      <section aria-label="Current status distribution" className="rounded-lg border bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Current status distribution</h2>
        <p className="mt-1 text-sm text-gray-500">All <strong data-current-total>{data.currentStatus.total}</strong> saved applications now. This section is not filtered by the selected dates.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{Object.entries(LABELS).map(([status, label]) => <div key={status} className="rounded border p-3">
          <p className="text-sm text-gray-600">{label}</p><p data-current-status={status} className="mt-1 text-2xl font-semibold">{data.currentStatus.counts[status]}</p>
          <p className="text-xs text-gray-500">{percent(data.currentStatus.total ? data.currentStatus.counts[status] / data.currentStatus.total * 100 : 0)} of current applications</p>
          <div className="mt-2 h-2 rounded bg-gray-100"><div className={`h-2 rounded ${COLORS[status]}`} style={{ width: `${data.currentStatus.total ? data.currentStatus.counts[status] / data.currentStatus.total * 100 : 0}%` }} /></div>
        </div>)}</div>
      </section>
      <section aria-label="Stage conversion" className="rounded-lg border bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Stage conversion</h2>
        <p className="mt-1 text-sm text-gray-600"><strong data-cohort-total>{data.cohort.total}</strong> applications submitted in this period, observed through the selected end date (or now for today).</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">{[
          ['appliedToInterview', 'Applied → Interview / assessment'], ['interviewToOffer', 'Interview / assessment → Offer'], ['appliedToOffer', 'Applied → Offer'],
        ].map(([key, label]) => <div key={key} className="rounded border bg-blue-50 p-4"><h3 className="text-sm text-gray-700">{label}</h3>
          <p data-conversion={key} className="mt-2 text-2xl font-semibold text-blue-800">{percent(data.cohort.conversion[key].percent)}</p>
          <p data-conversion-fraction={key} className="mt-1 text-sm text-gray-600">{data.cohort.conversion[key].numerator} / {data.cohort.conversion[key].denominator} applications</p>
        </div>)}</div>
        <p className="mt-3 text-sm text-gray-600">Reached interview / assessment: {data.cohort.reached.interviewing} · Reached offer: {data.cohort.reached.offer} · Recorded rejection: {data.cohort.reached.rejected}</p>
        <p className="mt-2 text-xs text-gray-500">Each application counts once per stage. Rejections do not imply an interview. A zero denominator is shown as —.</p>
        {(data.cohort.offersWithoutPriorInterview > 0 || data.cohort.withoutHistory > 0) && <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
          {data.cohort.offersWithoutPriorInterview} offers without prior interview / assessment evidence count only toward the overall offer rate. {data.cohort.withoutHistory} applications have no recorded history in their observation period.
        </p>}
        <details className="mt-3 text-sm text-gray-600"><summary className="cursor-pointer text-blue-700">How conversion is calculated</summary>
          <p className="mt-2">Applications are grouped by their application date in the selected time zone. Stages use recorded history from that date through the period end, capped at now. Interview / assessment includes online assessments. An offer must be at or after a recorded interview / assessment to count in the conversion numerator.</p>
          <p className="mt-2">Repeated rounds count once. Deleted records and future events are excluded. Historical emails can establish a stage even when they retain a newer current status. Missing stages are not inferred from current status. Changing the date range changes both the application group and how long it is observed.</p>
        </details>
      </section>
      <Timeline timeline={data.timeline} />
      <section aria-label="Application progression" className="rounded-lg border bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Application progression</h2><p className="mt-1 text-sm text-gray-500">First recorded stage dates for this application group. These are history dates, not appointment times.</p>
        {data.cohort.total === 0 ? <p className="py-6 text-sm text-gray-500">No applications were submitted in this range.</p> : <>
          <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Application', 'Applied', 'Interview / assessment', 'Offer', 'Rejected'].map((label) => <th key={label} className="whitespace-nowrap p-2">{label}</th>)}</tr></thead>
            <tbody>{data.cohort.applications.slice(activePage * 20, (activePage + 1) * 20).map((row) => <tr key={row.id} data-progression-id={row.id} className="border-t">
              <th className="min-w-40 p-2 font-normal"><span className="block font-medium">{row.company}</span><span className="text-xs text-gray-500">{row.position}</span></th>
              {['appliedAt', 'interviewAt', 'offerAt', 'rejectedAt'].map((key) => <td key={key} className="whitespace-nowrap p-2">{formatDate(row[key], data.range.timeZone)}</td>)}
            </tr>)}</tbody>
          </table></div>
          <div className="mt-3 flex items-center justify-end gap-3 text-sm"><button disabled={activePage === 0} onClick={() => setPage(activePage - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Previous applications</button><span>{activePage + 1} / {pages}</span><button disabled={activePage + 1 >= pages} onClick={() => setPage(activePage + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Next applications</button></div>
        </>}
      </section>
    </>}
  </div>;
}
