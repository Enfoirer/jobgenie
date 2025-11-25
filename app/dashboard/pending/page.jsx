// app/dashboard/pending/page.jsx
'use client';

import { useEffect, useState } from 'react';

export default function PendingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/pending');
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
      const res = await fetch(`/api/pending/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
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
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                    {item.eventType} · {(item.confidence || 0).toFixed(2)}
                  </span>
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
                </div>
              </div>
              {item.snippet && (
                <p className="mt-2 text-sm text-gray-700 line-clamp-3">{item.snippet}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
