'use client';

import { useState } from 'react';

export default function BulkActions({ records, selected, onSelect, endpoint, actions, updates, onComplete, busy, onBusy }) {
  const [action, setAction] = useState(actions[0].value);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const selectedRecords = records.filter((item) => selected.includes(item._id));
  const option = actions.find((item) => item.value === action) || actions[0];
  async function submit() {
    const ids = selectedRecords.map((item) => item._id);
    if (!ids.length || busy || !window.confirm(`${option.label}: ${ids.length} selected records? ${option.description || ''}`)) return;
    onBusy(true); setError(''); setReport(null);
    try {
      const payload = { ids, action: option.action || option.value, ...(option.status && { status: option.status }) };
      if (updates && payload.action === 'accept') payload.updates = Object.fromEntries(ids.filter((id) => updates[id]).map((id) => [id, updates[id]]));
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Bulk action failed');
      setReport({ ...data, results: data.results.map((result) => ({ ...result, label: records.find((r) => r._id === result.id)?.company || records.find((r) => r._id === result.id)?.subject || result.id })) });
      onSelect(data.results.filter((item) => !item.success).map((item) => item.id));
      await onComplete(data);
    } catch (error) { setError(error.message || 'Could not confirm completion. Refresh before retrying.'); }
    finally { onBusy(false); }
  }
  return <section aria-label="Bulk actions" className="rounded-lg border bg-white p-4 space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={() => onSelect(records.slice(0, 50).map((item) => item._id))} className="text-sm text-blue-700 disabled:opacity-50">Select visible (up to 50)</button>
      <button type="button" disabled={busy} onClick={() => onSelect([])} className="text-sm text-gray-600">Clear selection</button>
      <span className="text-sm">{selectedRecords.length} selected</span>
      <select aria-label="Bulk action" value={option.value} onChange={(event) => setAction(event.target.value)} disabled={busy} className="rounded border-gray-300 text-sm">
        {actions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <button type="button" onClick={submit} disabled={busy || !selectedRecords.length} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Processing…' : 'Apply to selected'}</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {report && <div role="status" className="text-sm"><p>{report.succeeded} succeeded · {report.failed} failed. Failed records remain selected for retry.</p>
      {!!report.failed && <ul className="mt-2 text-red-700">{report.results.filter((item) => !item.success).map((item) => <li key={item.id}>{item.label}: {item.error}</li>)}</ul>}
    </div>}
  </section>;
}
