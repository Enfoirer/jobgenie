'use client';

import { useEffect, useState } from 'react';
import { COLUMN_NAMES, INTERVIEW_STAGES } from '@/lib/mockData';
import Modal from './Modal';

function localInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
export default function StatusChangeModal({ job, suggestedStatus, onClose, onStatusChange }) {
  const [form, setForm] = useState({
    status: suggestedStatus || job.status, interviewStage: '',
    date: new Date().toISOString(), notes: '', scheduledTime: null, deadline: null,
  });
  const [previousStages, setPreviousStages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`/api/jobs/${job._id}/status-history`).then(async (response) => {
      if (response.ok && active) {
        const data = await response.json();
        if (active) setPreviousStages(data.statusHistory.filter((entry) => entry.status === 'interviewing' && entry.interviewStage));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [job._id]);
  const change = (event) => setForm((previous) => ({
    ...previous, [event.target.name]: event.target.value,
    ...(event.target.name === 'status' && event.target.value !== 'interviewing' && { scheduledTime: null, deadline: null }),
  }));
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/jobs/${job._id}/status-history`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update status');
      onStatusChange(result.job);
      onClose();
    } catch (failure) { setError(failure.message); setBusy(false); }
  };
  return (
    <Modal title={`Update Status for ${job.company}`} onClose={onClose} busy={busy}>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="mb-4 text-sm text-gray-600">The latest event date determines the current status. Backdated entries stay on the timeline.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm text-gray-700">Status
            <select name="status" value={form.status} onChange={change} className="mt-1 block w-full rounded border-gray-300">
              {Object.entries(COLUMN_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {form.status === 'interviewing' && <label className="block text-sm text-gray-700">Interview Stage
            <select name="interviewStage" value={form.interviewStage} onChange={change} className="mt-1 block w-full rounded border-gray-300">
              <option value="">Select an interview stage</option>
              {INTERVIEW_STAGES.map((stage) => <option key={stage}>{stage}</option>)}
            </select>
            {previousStages.length > 0 && <span className="mt-1 block text-xs text-gray-500">Previous: {previousStages.map((entry) => entry.interviewStage).join(', ')}</span>}
          </label>}
          <label className="block text-sm text-gray-700">Event date and time
            <input type="datetime-local" step="1" value={form.date ? localInput(form.date) : ''}
              onChange={(event) => setForm((previous) => ({ ...previous, date: event.target.value ? new Date(event.target.value).toISOString() : '' }))}
              required className="mt-1 block w-full rounded border-gray-300" />
          </label>
          {form.status === 'interviewing' && <div className="space-y-4">
            <p className="text-xs text-gray-500">Use appointment time for an interview and deadline for an assessment. Leave unknown times empty to add them to Needs a time.</p>
            {[['scheduledTime', 'Appointment time (optional)'], ['deadline', 'Deadline (optional)']].map(([name, label]) => (
              <label key={name} className="block text-sm text-gray-700">{label}
                <input name={name} type="datetime-local" step="1" value={localInput(form[name])}
                  onChange={(event) => setForm((previous) => ({ ...previous, [name]: event.target.value ? new Date(event.target.value).toISOString() : null }))}
                  className="mt-1 block w-full rounded border-gray-300" />
              </label>
            ))}
          </div>}
          <label className="block text-sm text-gray-700">Notes
            <textarea name="notes" rows={3} maxLength={10000} value={form.notes} onChange={change} className="mt-1 block w-full rounded border-gray-300" />
          </label>
          <div className="flex justify-end gap-3 border-t pt-4">
            <button type="button" onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">{busy ? 'Updating...' : 'Update Status'}</button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
