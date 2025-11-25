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

  return (
    <div className="max-w-5xl">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">Pending 邮件</h1>
        <p className="mt-1 text-sm text-gray-500">
          审核自动解析的邮件，接受后会更新 Job 和 Timeline。
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[
          { key: 'pending', label: '待处理' },
          { key: 'accepted', label: '已接受' },
          { key: 'ignored', label: '已忽略' },
          { key: 'all', label: '全部' },
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
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-sm text-gray-500">加载中...</div>
      ) : items.length === 0 ? (
        <div className="mt-6 text-sm text-gray-500">暂无待处理邮件</div>
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
                        时间：{new Date(item.interviewTime).toLocaleString()}
                      </span>
                    )}
                    {item.deadline && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                        截止：{new Date(item.deadline).toLocaleString()}
                      </span>
                    )}
                    {item.needsScheduling && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                        需自行约时间
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
                    {expanded === item._id ? '收起' : '详情/编辑'}
                  </button>
                  {item.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleAction(item._id, 'accept')}
                        disabled={savingId === item._id}
                        className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                      >
                        {savingId === item._id ? '处理中...' : '接受'}
                      </button>
                      <button
                        onClick={() => handleAction(item._id, 'ignore')}
                        disabled={savingId === item._id}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        忽略
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
                  <span className="font-medium">摘要：</span>
                  {item.summary}
                </p>
              )}
              {item.rationale && (
                <p className="mt-1 text-xs text-gray-500">
                  <span className="font-medium">解析说明：</span>
                  {item.rationale}
                </p>
              )}

              {expanded === item._id && (
                <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-gray-600">公司</label>
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
                      <label className="block text-xs text-gray-600">岗位</label>
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
                      <label className="block text-xs text-gray-600">事件类型</label>
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
                      <label className="block text-xs text-gray-600">面试/事件时间</label>
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
                        {savingId === item._id ? '处理中...' : '保存并接受'}
                      </button>
                      <button
                        onClick={() => handleAction(item._id, 'ignore')}
                        disabled={savingId === item._id}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        忽略
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
