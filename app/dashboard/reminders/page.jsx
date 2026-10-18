'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useReminders } from '@/components/ReminderProvider';

const labels = { unread: 'Unread', snoozed: 'Snoozed', read: 'Read', cancelled: 'Cancelled' };
const displayTime = (value) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function Settings({ settings, refresh }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [leadMinutes, setLeadMinutes] = useState(settings.leadMinutes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/reminders/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, leadMinutes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save reminder settings');
      setMessage('Settings saved.');
      await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="rounded-lg border bg-white p-4 sm:p-6">
    <h2 className="mb-3 font-semibold">Reminder settings</h2>
    <fieldset disabled={busy} className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="rounded" />Enable in-app reminders</label>
      <label className="flex items-center gap-2 text-sm">Remind me before
        <select name="leadMinutes" value={leadMinutes} onChange={(event) => setLeadMinutes(Number(event.target.value))} className="rounded border-gray-300 text-sm">
          {[[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [1440, '24 hours']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="submit" className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save settings'}</button>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-green-700">{message}</p>}
  </form>;
}

export default function RemindersPage() {
  const { data, loading, error, refresh } = useReminders();
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  const [tab, setTab] = useState('active');
  const act = async (item, action) => {
    if (busy) return;
    setBusy(item.id); setActionError('');
    try {
      const response = await fetch('/api/reminders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ historyId: item.historyId, kind: item.kind, revision: item.revision, action }) });
      const result = await response.json();
      if (!response.ok) {
        if ([404, 409].includes(response.status)) await refresh();
        throw new Error(result.error || 'Unable to update reminder');
      }
      await refresh();
    } catch (failure) { setActionError(failure.message); }
    finally { setBusy(null); }
  };
  const all = data?.reminders || [];
  const rows = all.filter((item) => tab === 'active' ? ['unread', 'snoozed'].includes(item.status) : ['read', 'cancelled'].includes(item.status));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-gray-900">Reminders</h1><p className="mt-1 text-sm text-gray-600">Interview and assessment reminders from your calendar, in your local time zone.</p></div>
      <div className="flex gap-3"><Link href="/dashboard/todo" className="rounded border px-3 py-2 text-sm text-blue-700">Calendar & To-do</Link>
        <button onClick={refresh} disabled={loading || !!busy} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh reminders'}</button></div>
    </div>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error} Displayed reminders may be out of date.</p>}
    {data && <Settings key={`${data.settings.enabled}:${data.settings.leadMinutes}`} settings={data.settings} refresh={refresh} />}
    <details className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
      <summary className="cursor-pointer font-medium">Reminder timing, repeats and cancellation</summary>
      <p className="mt-3">One reminder per appointment or deadline. Marking it read stops repeats. Snooze brings it back once after 10 minutes; you can snooze again while more than 10 minutes remain.</p>
      <p className="mt-2">Cancel stops this occurrence only. Rescheduling cancels the old reminder and starts a new one. Clearing the time, deleting the history/application, or moving the application to Offer/Rejected stops reminders. Reopening an application resumes eligible, unhandled reminders.</p>
      <p className="mt-2">Reminders refresh every 30 seconds while the app is visible and when you return. No email or browser push is sent while the app is closed. Missing times never trigger reminders. After the appointment or deadline, check Calendar & To-do.</p>
      <p className="mt-2">Changing the lead time or switching reminders off and back on keeps read/cancelled choices. Handled items are shown only while their current reminder window is open.</p>
    </details>
    <section aria-label="Reminder list" aria-busy={loading} className="rounded-lg border bg-white p-4 sm:p-6">
      <div className="flex gap-4 border-b pb-3">
        {[['active', 'Active'], ['handled', 'Handled']].map(([key, label]) => <button key={key} onClick={() => setTab(key)} aria-pressed={tab === key}
          className={`rounded px-3 py-1 text-sm ${tab === key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600'}`}>{label}</button>)}
      </div>
      {actionError && <p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p>}
      {!data && loading ? <p className="py-6 text-sm text-gray-500">Loading reminders...</p> : rows.length === 0 ? <p className="py-6 text-sm text-gray-500">
        {error ? 'Reminders unavailable. Use Refresh reminders to retry.' : data?.settings.enabled === false ? 'In-app reminders are off.' : tab === 'handled' ? 'No handled reminders in the current window.' : 'No active reminders. Upcoming events appear when their reminder window opens.'}
      </p> : <ul className="divide-y">
        {rows.map((item) => <li key={item.id} data-reminder-id={item.id} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 break-words"><h2 className="font-semibold">{item.company} — {item.position}</h2>
              <p className="mt-1 text-sm text-gray-700">{item.label} · {displayTime(item.time)}</p>
              {item.snoozedUntil && <p className="mt-1 text-sm text-gray-500">Remind again: {displayTime(item.snoozedUntil)}</p>}</div>
            <span className={`rounded px-2 py-1 text-xs ${item.status === 'unread' ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{labels[item.status]}</span>
          </div>
          {tab === 'active' && <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <button disabled={!!busy} onClick={() => act(item, 'read')} className="rounded border px-3 py-2 disabled:opacity-50">Mark read</button>
            {item.status === 'unread' && <button disabled={!!busy || !item.canSnooze} onClick={() => act(item, 'snooze')}
              title={item.canSnooze ? 'Remind again in 10 minutes' : 'Less than 10 minutes remain'} className="rounded border px-3 py-2 disabled:opacity-50">Snooze 10 minutes</button>}
            <button disabled={!!busy} onClick={() => act(item, 'cancel')} className="rounded border px-3 py-2 text-red-700 disabled:opacity-50">Cancel reminder</button>
          </div>}
        </li>)}
      </ul>}
    </section>
  </div>;
}
