// components/SyncSettingsPanel.jsx
'use client';

import { useEffect, useState } from 'react';

export default function SyncSettingsPanel() {
  const [syncMode, setSyncMode] = useState('semi');
  const [threshold, setThreshold] = useState(0.7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/sync-settings');
        if (!res.ok) {
          throw new Error('加载失败');
        }
        const data = await res.json();
        setSyncMode(data.syncMode || 'semi');
        setThreshold(data.autoThreshold ?? 0.7);
      } catch (e) {
        setError(e.message || '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const res = await fetch('/api/sync-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncMode,
          autoThreshold: threshold,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '保存失败');
      }
      setSuccess('已保存');
    } catch (e) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Sync mode</h3>
          <p className="text-sm text-gray-500">
            Auto: high-confidence items update jobs directly; Semi/Strict: everything goes to Pending.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="mt-4 space-y-3">
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="syncMode"
                value="auto"
                checked={syncMode === 'auto'}
                onChange={() => setSyncMode('auto')}
              />
              <span className="text-sm text-gray-800">Auto</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="syncMode"
                value="semi"
                checked={syncMode === 'semi'}
                onChange={() => setSyncMode('semi')}
              />
              <span className="text-sm text-gray-800">Semi-auto (all go to Pending)</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="syncMode"
                value="strict"
                checked={syncMode === 'strict'}
                onChange={() => setSyncMode('strict')}
              />
              <span className="text-sm text-gray-800">Strict (no auto updates)</span>
            </label>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700">Auto confidence threshold</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="mt-1 w-32 rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
              disabled={syncMode !== 'auto'}
            />
          </div>

          <div className="mt-4 flex items-center space-x-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
            {success && <span className="text-sm text-green-600">{success}</span>}
          </div>
        </>
      )}
    </div>
  );
}
