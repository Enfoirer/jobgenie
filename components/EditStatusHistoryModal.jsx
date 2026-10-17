'use client';

// Adapted from origin/testing; fix deletion identity, retain full timestamp
// precision on unchanged dates, and refresh both history and the parent board.
import { useState } from 'react';
import { COLUMN_NAMES, INTERVIEW_STAGES } from '@/lib/mockData';
import Modal from './Modal';

function localInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
export default function EditStatusHistoryModal({ statusEntry, jobId, onClose, onUpdate }) {
  const [form, setForm] = useState({
    status: statusEntry.status, interviewStage: statusEntry.interviewStage || '',
    date: statusEntry.date, notes: statusEntry.notes || '',
    scheduledTime: statusEntry.scheduledTime || null, deadline: statusEntry.deadline || null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (event) => setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  const save = async (remove = false) => {
    if (busy || (remove && !window.confirm('Delete this history entry? The current application status will be recalculated.'))) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/jobs/${jobId}/status-history/${statusEntry._id}`, {
        method: remove ? 'DELETE' : 'PATCH',
        ...(!remove && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to change history');
      await onUpdate(result.job);
      onClose();
    } catch (failure) { setError(failure.message); setBusy(false); }
  };
  return (
    <Modal title="Edit Status History" onClose={onClose} busy={busy}>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="mb-4 text-sm text-gray-600">The current status follows the latest active history entry. If none remain, it returns to Applied.</p>
      {statusEntry.statusApplied === false && <p className="mb-4 text-sm text-blue-700">This email is history only. Editing it will retain the current application status.</p>}
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm text-gray-700">Status
            <select name="status" value={form.status} onChange={change} className="mt-1 block w-full rounded border-gray-300">
              {Object.entries(COLUMN_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {form.status === 'interviewing' && <label className="block text-sm text-gray-700">Interview Stage
            <select name="interviewStage" value={form.interviewStage} onChange={change} className="mt-1 block w-full rounded border-gray-300">
              <option value="">Select an interview stage</option>
              {form.interviewStage && !INTERVIEW_STAGES.includes(form.interviewStage) && <option value={form.interviewStage}>{form.interviewStage}</option>}
              {INTERVIEW_STAGES.map((stage) => <option key={stage}>{stage}</option>)}
            </select>
          </label>}
          {[['date', 'Event date and time'], ['scheduledTime', 'Appointment time (optional)'], ['deadline', 'Deadline (optional)']].map(([name, label]) => (
            <label key={name} className="block text-sm text-gray-700">{label}
              <input type="datetime-local" step="1" required={name === 'date'} value={localInput(form[name])}
                onChange={(event) => setForm((previous) => ({ ...previous, [name]: event.target.value ? new Date(event.target.value).toISOString() : null }))}
                className="mt-1 block w-full rounded border-gray-300" />
            </label>
          ))}
          <label className="block text-sm text-gray-700">Notes
            <textarea name="notes" rows={4} maxLength={10000} value={form.notes} onChange={change} className="mt-1 block w-full rounded border-gray-300" />
          </label>
          <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
            <button type="button" onClick={() => save(true)} className="rounded border border-red-200 px-4 py-2 text-red-700">Delete History</button>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
