// app/dashboard/pending/page.jsx
'use client';

import { useEffect, useState } from 'react';

export default function PendingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [expanded, setExpanded] = useState(null);
  const [edits, setEdits] = useState({});

  useEffect(() => {
    fetchItems();
  }, [filter]);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/pending?status=${filter}`);
      if (!res.ok) {
        throw new Error('加载失败');
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id, action) => {
    setSavingId(id);
    try {
      const payload = { action };
      if (action === 'accept' && edits[id]) {
        payload.updates = edits[id];
      }
      const res = await fetch(`/api/pending/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '操作失败');
      }
      await fetchItems();
    } catch (e) {
      setError(e.message || '操作失败');
    } finally {
      setSavingId(null);
    }
  };

  const clearProcessed = async () => {
    if (!confirm('确认清空当前视图的已处理记录？')) return;
    try {
      setError('');
      const res = await fetch(`/api/pending/clear?status=${filter}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '清空失败');
      }
      await fetchItems();
    } catch (e) {
      setError(e.message || '清空失败');
    }
  };

  return (
    <div className="max-w-6xl px-4 sm:px-0">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">Pending Emails</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review parsed emails. Accept will update Jobs and Timeline.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[
          { key: 'pending', label: 'Pending' },
          { key: 'accepted', label: 'Accepted' },
          { key: 'ignored', label: 'Ignored' },
          { key: 'all', label: 'All' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1 text-sm ${
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
        {filter !== 'pending' && (
          <button
            onClick={clearProcessed}
            className="rounded-md border border-red-200 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Clear this view
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-sm text-gray-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="mt-6 text-sm text-gray-500">No items</div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item._id} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.subject}</p>
                  <p className="text-xs text-gray-500">
                    {item.from} · {item.provider.toUpperCase()} ·{' '}
                    {item.receivedAt ? new Date(item.receivedAt).toLocaleString() : ''}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                    {item.interviewTime && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                        Time: {new Date(item.interviewTime).toLocaleString()}
                      </span>
                    )}
                    {item.deadline && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                        Deadline: {new Date(item.deadline).toLocaleString()}
                      </span>
                    )}
                    {item.needsScheduling && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                        Needs scheduling
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                    {item.eventType} · {(item.confidence || 0).toFixed(2)}
                  </span>
                  {item.status !== 'pending' && (
                    <span className="rounded-full bg-green-50 px-2 py-1 text-xs text-green-700">
                      {item.status}
                    </span>
                  )}
                  <button
                    onClick={() => setExpanded(expanded === item._id ? null : item._id)}
                    disabled={savingId === item._id}
                    className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {expanded === item._id ? 'Hide' : 'Details/Edit'}
                  </button>
                  {item.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleAction(item._id, 'accept')}
                        disabled={savingId === item._id}
                        className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                      >
                        {savingId === item._id ? 'Processing...' : 'Accept'}
                      </button>
                      <button
                        onClick={() => handleAction(item._id, 'ignore')}
                        disabled={savingId === item._id}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        Ignore
                      </button>
                    </>
                  )}
                </div>
              </div>
              {item.snippet && (
                <p className="mt-2 text-sm text-gray-700 line-clamp-3">{item.snippet}</p>
              )}
              {item.summary && (
                <p className="mt-2 text-sm text-gray-600">
                      <span className="font-medium">Summary: </span>
                      {item.summary}
                    </p>
                  )}
                  {item.rationale && (
                    <p className="mt-1 text-xs text-gray-500">
                      <span className="font-medium">Notes: </span>
                      {item.rationale}
                    </p>
                  )}

              {expanded === item._id && (
                <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-gray-600">Company</label>
                      <input
                        type="text"
                        defaultValue={item.company || ''}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [item._id]: { ...(prev[item._id] || {}), company: e.target.value },
                          }))
                        }
                        className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Position</label>
                      <input
                        type="text"
                        defaultValue={item.position || ''}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [item._id]: { ...(prev[item._id] || {}), position: e.target.value },
                          }))
                        }
                        className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Event Type</label>
                      <select
                        defaultValue={item.eventType || 'other'}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [item._id]: { ...(prev[item._id] || {}), eventType: e.target.value },
                          }))
                        }
                        className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        {['submission', 'oa', 'interview', 'rejection', 'offer', 'other'].map(
                          (opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Interview/Event Time</label>
                      <input
                        type="datetime-local"
                        defaultValue={
                          item.interviewTime
                            ? new Date(item.interviewTime).toISOString().slice(0, 16)
                            : ''
                        }
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [item._id]: {
                              ...(prev[item._id] || {}),
                              interviewTime: e.target.value ? new Date(e.target.value) : null,
                            },
                          }))
                        }
                        className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  {item.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(item._id, 'accept')}
                        disabled={savingId === item._id}
                        className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                      >
                        {savingId === item._id ? 'Processing...' : 'Save & Accept'}
                      </button>
                      <button
                        onClick={() => handleAction(item._id, 'ignore')}
                        disabled={savingId === item._id}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        Ignore
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
