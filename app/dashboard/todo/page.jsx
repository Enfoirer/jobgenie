'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import EditStatusHistoryModal from '@/components/EditStatusHistoryModal';
import { COLUMN_NAMES } from '@/lib/mockData';
import { dayKey, monthDays, scheduleBucket } from '@/lib/schedule/events';

const filters = { upcoming: 'Upcoming', overdue: 'Overdue / past', unscheduled: 'Needs a time' };
const timeLabel = (time) => time ? new Date(time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Time not set';

export default function TodoPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(null);
  const [month, setMonth] = useState(null);
  const [filter, setFilter] = useState('upcoming');
  const [selectedDay, setSelectedDay] = useState(null);
  const [editing, setEditing] = useState(null);
  const pending = useRef(null);

  const reload = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const response = await fetch('/api/schedule', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again to load your schedule.' : 'Unable to load your schedule. Please retry.');
      const result = await response.json();
      if (!controller.signal.aborted) { setEvents(result.events); setError(''); setNow(Date.now()); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
    reload();
    const refresh = () => { if (document.visibilityState === 'visible') reload(); };
    const tick = setInterval(() => { setNow(Date.now()); refresh(); }, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      pending.current?.abort(); clearInterval(tick);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);

  const byDay = useMemo(() => {
    const days = new Map();
    for (const event of events) {
      if (!event.time) continue;
      const key = dayKey(event.time);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(event);
    }
    return days;
  }, [events]);
  const counts = { upcoming: 0, overdue: 0, unscheduled: 0 };
  for (const event of events) counts[scheduleBucket(event, now)]++;
  const visible = selectedDay ? byDay.get(selectedDay) || [] : events.filter((event) => scheduleBucket(event, now) === filter);
  // Nearest future events first; most recently elapsed events first.
  const rows = !selectedDay && filter === 'overdue' ? [...visible].reverse() : visible;
  const changeMonth = (offset) => { setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1, 12)); setSelectedDay(null); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar & To-do</h1>
          <p className="mt-1 text-sm text-gray-600">Interview appointments and assessment deadlines, including applications that have moved to Offer or Rejected.</p>
          {now && <p className="mt-1 text-xs text-gray-500">All times in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Missing dates stay in Needs a time.</p>}
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/jobs" className="rounded border px-3 py-2 text-sm text-blue-700">Add via Job Board</Link>
          <button onClick={reload} disabled={loading} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error} Previously loaded items may be out of date.</p>}
      <div className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="Schedule filters">
        {Object.entries(filters).map(([key, label]) => (
          <button key={key} data-filter={key} aria-pressed={!selectedDay && filter === key}
            onClick={() => { setFilter(key); setSelectedDay(null); }}
            className={`rounded-lg border p-3 text-left sm:p-4 ${!selectedDay && filter === key ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-700'}`}>
            <span className="block text-xs sm:text-sm">{label}</span>
            <span className="mt-1 block text-2xl font-semibold" data-count={key}>{counts[key]}</span>
          </button>
        ))}
      </div>
      {month && <section aria-label="Monthly calendar" className="overflow-hidden rounded-lg border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h2 className="font-semibold">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
          <div className="flex gap-2 text-sm">
            <button aria-label="Previous month" onClick={() => changeMonth(-1)} className="rounded border px-3 py-1">←</button>
            <button onClick={() => { const date = new Date(); setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12)); setSelectedDay(dayKey(date)); }} className="rounded border px-3 py-1">Today</button>
            <button aria-label="Next month" onClick={() => changeMonth(1)} className="rounded border px-3 py-1">→</button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-gray-500">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="border-t py-2">{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {monthDays(month.getFullYear(), month.getMonth()).map((date) => {
            const key = dayKey(date), items = byDay.get(key) || [];
            return <div key={key} data-day={key} className={`min-w-0 border-t border-r p-1 sm:p-2 ${selectedDay === key ? 'bg-blue-50' : date.getMonth() === month.getMonth() ? 'bg-white' : 'bg-gray-50 text-gray-400'}`}>
              <button onClick={() => setSelectedDay(key)} aria-label={`${date.toLocaleDateString()}, ${items.length} events`}
                aria-pressed={selectedDay === key} aria-current={key === dayKey(now) ? 'date' : undefined}
                className={`min-h-8 w-full rounded text-left text-xs sm:text-sm ${key === dayKey(now) ? 'font-bold text-blue-700' : ''}`}>
                {date.getDate()}<span className="ml-1 text-[10px] text-gray-500 sm:hidden">{items.length > 0 ? `(${items.length})` : ''}</span>
              </button>
              <div className="min-h-4 space-y-1 sm:min-h-16">
                {items.slice(0, 2).map((event) => <button key={event.id} onClick={() => setEditing(event)}
                  title={`${event.company} · ${event.label} · ${timeLabel(event.time)}`} aria-label={`${event.company}, ${event.label}, ${timeLabel(event.time)}`}
                  className={`hidden w-full truncate rounded p-1 text-left text-xs sm:block ${event.kind === 'deadline' ? 'bg-amber-50 text-amber-900' : 'bg-blue-50 text-blue-800'}`}>
                  {new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {event.company}
                </button>)}
                {items.length > 2 && <button onClick={() => setSelectedDay(key)} className="hidden text-xs text-blue-700 sm:block">+{items.length - 2} more</button>}
              </div>
            </div>;
          })}
        </div>
      </section>}
      <section aria-label="Schedule list" aria-busy={loading} className="rounded-lg border bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{selectedDay ? `Events on ${selectedDay}` : filters[filter]}</h2>
          {selectedDay && <button onClick={() => setSelectedDay(null)} className="text-sm text-blue-700">Clear day filter</button>}
        </div>
        <p className="mt-1 text-xs text-gray-500">Overdue / past means the time has passed; it does not indicate whether an interview or assessment was completed. Both times on one history entry appear separately.</p>
        <p className="mt-1 text-xs text-gray-500">Editing updates the shared history entry. Deleting it removes all of its calendar items.</p>
        {loading && events.length === 0 ? <p className="py-6 text-sm text-gray-500">Loading schedule...</p> : rows.length === 0 ?
          <p className="py-6 text-sm text-gray-500">{error ? 'Schedule unavailable. Use Refresh to retry.' : selectedDay ? 'No scheduled events on this day.' : filter === 'unscheduled' ? 'No events need a time.' : 'No events in this list.'}</p> :
          <ul className="mt-4 divide-y">
            {rows.map((event) => <li key={event.id} data-event-id={event.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0 flex-1 break-words">
                <h3 className="font-medium text-gray-900">{event.company} — {event.position}</h3>
                <p className="mt-1 text-sm text-gray-700">{event.label}{event.history.interviewStage && ` · ${event.history.interviewStage}`}</p>
                <p className="mt-1 text-sm font-medium text-blue-700">{timeLabel(event.time)}</p>
                <p className="mt-1 text-xs text-gray-500">Application: {COLUMN_NAMES[event.applicationStatus]}{event.location && ` · ${event.location}`}</p>
                {event.history.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{event.history.notes}</p>}
              </div>
              <button onClick={() => setEditing(event)} className="rounded border px-3 py-2 text-sm text-blue-700">Edit / delete</button>
            </li>)}
          </ul>}
      </section>
      {editing && <EditStatusHistoryModal key={editing.historyId} jobId={editing.jobId} statusEntry={editing.history}
        onClose={() => setEditing(null)} onUpdate={reload} />}
    </div>
  );
}
