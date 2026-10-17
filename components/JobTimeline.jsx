'use client';

import { useCallback, useEffect, useState } from 'react';
import { COLUMN_NAMES } from '@/lib/mockData';
import Modal from './Modal';
import EditStatusHistoryModal from './EditStatusHistoryModal';

export default function JobTimeline({ jobId, onClose, onJobUpdate }) {
  const [histories, setHistories] = useState([]);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const responses = await Promise.all([fetch(`/api/jobs/${jobId}`), fetch(`/api/jobs/${jobId}/status-history`)]);
      if (responses.some((response) => !response.ok)) throw new Error('Failed to load timeline. Close and reopen it to retry.');
      const [details, history] = await Promise.all(responses.map((response) => response.json()));
      setJob(details.job); setHistories(history.statusHistory);
    } catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, [jobId]);
  useEffect(() => { reload(); }, [reload]);
  const changed = async (updatedJob) => {
    setJob(updatedJob);
    onJobUpdate?.(updatedJob);
    await reload();
  };
  return (
    <Modal title={job ? `${job.company} — ${job.position} Timeline` : 'Application Timeline'} onClose={onClose}>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {job && <p className="mb-4 text-sm text-gray-700">Current status: <strong>{COLUMN_NAMES[job.status]}</strong></p>}
      {loading ? <p>Loading timeline...</p> : histories.length === 0 ? <p className="text-sm text-gray-500">No status history available.</p> : (
        <ol className="space-y-4 border-l-2 border-blue-100 pl-4">
          {histories.map((entry) => (
            <li key={entry._id} className="rounded border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-gray-900">{COLUMN_NAMES[entry.status]}{entry.status === 'interviewing' && entry.interviewStage ? ` — ${entry.interviewStage}` : ''}</h3>
                  <p className="text-xs text-gray-500">{new Date(entry.date).toLocaleString()}</p>
                </div>
                <button type="button" onClick={() => setEditing(entry)} className="text-sm text-blue-600 hover:underline">Edit History</button>
              </div>
              {entry.statusApplied === false && <p className="mt-2 text-xs text-blue-700">Recorded as history; current status retained.</p>}
              {entry.source?.messageId && <div className="mt-2 break-words text-xs text-gray-500">
                <p>{entry.source.provider} · {entry.source.from} · {entry.source.subject}</p>
                {entry.source.receivedAt && <p>Received: {new Date(entry.source.receivedAt).toLocaleString()}</p>}
              </div>}
              {entry.scheduledTime && <p className="mt-2 text-xs text-gray-600">Scheduled: {new Date(entry.scheduledTime).toLocaleString()}</p>}
              {entry.deadline && <p className="mt-1 text-xs text-gray-600">Deadline: {new Date(entry.deadline).toLocaleString()}</p>}
              {entry.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-700">{entry.notes}</p>}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className="rounded border px-4 py-2">Close</button></div>
      {editing && <EditStatusHistoryModal key={editing._id} statusEntry={editing} jobId={jobId}
        onClose={() => setEditing(null)} onUpdate={changed} />}
    </Modal>
  );
}
