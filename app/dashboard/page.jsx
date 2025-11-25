// app/dashboard/page.jsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { COLUMNS, COLUMN_NAMES } from '@/lib/mockData';

const STATUS_COLORS = {
  [COLUMNS.APPLIED]: 'bg-blue-500',
  [COLUMNS.INTERVIEWING]: 'bg-yellow-500',
  [COLUMNS.OFFER]: 'bg-green-500',
  [COLUMNS.REJECTED]: 'bg-red-500',
};

export default function DashboardPage() {
  const [days, setDays] = useState(60);
  const [data, setData] = useState({ timeline: {}, funnel: {} });
  const [statusFilter, setStatusFilter] = useState([
    COLUMNS.APPLIED,
    COLUMNS.INTERVIEWING,
    COLUMNS.OFFER,
    COLUMNS.REJECTED,
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/stats?days=${days}`);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || 'Failed to load stats');
        }
        const json = await res.json();
        setData(json);
        setError('');
      } catch (e) {
        setError(e.message || 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [days]);

  const timelinePoints = useMemo(() => {
    const entries = Object.entries(data.timeline || {});
    const sorted = entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return sorted.map(([day, counts]) => ({
      day,
      counts,
    }));
  }, [data]);

  const maxCount =
    timelinePoints.reduce((max, p) => {
      const sum = statusFilter.reduce((acc, s) => acc + (p.counts[s] || 0), 0);
      return Math.max(max, sum);
    }, 1) || 1;

  const toggleStatus = (s) => {
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Timeline of status updates and funnel conversion.
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-gray-800">Timeline</h2>
            <p className="text-sm text-gray-500">Status updates per day (past 60 days). Scroll horizontally to view older days.</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[COLUMNS.APPLIED, COLUMNS.INTERVIEWING, COLUMNS.OFFER, COLUMNS.REJECTED].map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium border ${
                statusFilter.includes(s)
                  ? `${STATUS_COLORS[s]} text-white border-transparent`
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              {COLUMN_NAMES[s]}
            </button>
          ))}
        </div>

        <div className="mt-4 h-80 rounded-md border bg-gray-50 p-3 overflow-x-auto">
          {loading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : timelinePoints.length === 0 ? (
            <div className="text-sm text-gray-500">No data</div>
          ) : (
            <div className="relative h-full">
              <div className="absolute left-0 top-0 flex h-full flex-col justify-between text-[10px] text-gray-500">
                {[1, 0.75, 0.5, 0.25, 0].map((t) => (
                  <div key={t} className="flex items-center gap-1">
                    <span className="w-6 text-right">{Math.round(maxCount * t)}</span>
                    <span className="h-px w-4 bg-gray-200"></span>
                  </div>
                ))}
              </div>
              <div
                className="absolute left-12 right-0 bottom-0 top-0 flex items-end gap-2"
                style={{ width: `${timelinePoints.length * 48}px` }}
              >
                {timelinePoints.map((p) => {
                  const total = statusFilter.reduce((acc, s) => acc + (p.counts[s] || 0), 0);
                  const columnHeight = total === 0 ? 0 : (total / maxCount) * 100;
                  return (
                    <div key={p.day} className="flex flex-col items-center min-w-[40px]">
                      <div
                        className="flex w-full flex-col justify-end gap-0.5 rounded bg-white px-1 py-1 shadow-sm border"
                        style={{ height: `${Math.max(4, columnHeight)}%` }}
                      >
                        {statusFilter.map((s) => {
                          const count = p.counts[s] || 0;
                          if (!count || total === 0) return null;
                          return (
                            <div
                              key={s}
                              className={`${STATUS_COLORS[s]} rounded-sm`}
                              style={{
                                height: `${(count / total) * 100}%`,
                                minHeight: '6px',
                              }}
                              title={`${COLUMN_NAMES[s]}: ${count}`}
                            ></div>
                          );
                        })}
                      </div>
                      <div className="mt-1 text-[10px] text-gray-600">{p.day.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
