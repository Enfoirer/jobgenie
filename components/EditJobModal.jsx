'use client';

// Selectively adapted from origin/testing's EditJobModal. Status changes keep
// their dedicated flow; this editor changes application details only.
import { useState } from 'react';
import Modal from './Modal';

export default function EditJobModal({ job, onClose, onUpdate }) {
  const [form, setForm] = useState(() => Object.fromEntries(
    ['company', 'position', 'location', 'notes', 'jobUrl'].map((field) => [field, job[field] || '']),
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (event) => setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/jobs/${job._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update application');
      onUpdate(result.job);
      onClose();
    } catch (failure) { setError(failure.message); setBusy(false); }
  };
  return (
    <Modal title="Edit Job" onClose={onClose} busy={busy}>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="space-y-4">
          {[
            ['company', 'Company', 'text', true], ['position', 'Position', 'text', true],
            ['location', 'Location', 'text', false], ['jobUrl', 'Job URL', 'url', false],
          ].map(([name, label, type, required]) => (
            <label key={name} className="block text-sm text-gray-700">{label}
              <input name={name} type={type} required={required} maxLength={name === 'jobUrl' ? 2048 : 200}
                value={form[name]} onChange={change} placeholder={name === 'jobUrl' ? 'https://example.com/jobs/123' : undefined}
                className="mt-1 block w-full rounded border-gray-300" />
            </label>
          ))}
          <label className="block text-sm text-gray-700">Notes
            <textarea name="notes" rows={4} maxLength={10000} value={form.notes} onChange={change}
              className="mt-1 block w-full rounded border-gray-300" />
          </label>
          <div className="flex justify-end gap-3 border-t pt-4">
            <button type="button" onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
