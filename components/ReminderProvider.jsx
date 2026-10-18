'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const ReminderContext = createContext(null);
export const useReminders = () => useContext(ReminderContext);

export default function ReminderProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(null);
  const pathname = usePathname();
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch('/api/reminders', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again.' : 'Unable to load reminders. Please retry.');
      const result = await response.json();
      if (!controller.signal.aborted) { setData(result); setError(''); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [pathname, refresh]);
  useEffect(() => {
    const visibleRefresh = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(visibleRefresh, 30000);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('jobgenie:schedule-changed', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      request.current?.abort(); clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('jobgenie:schedule-changed', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [refresh]);
  return <ReminderContext.Provider value={{ data, error, loading, refresh }}>{children}</ReminderContext.Provider>;
}

export function ReminderLink() {
  const { data, error } = useReminders();
  return <Link href="/dashboard/reminders" aria-label={error ? 'Reminders unavailable' : `Reminders: ${data?.unreadCount ?? 0} unread`}
    className="relative mx-2 inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-sm text-blue-700">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 20h6" />
    </svg>
    <span className="hidden lg:inline">Reminders</span>
    <span data-reminder-count className="min-w-4 text-center font-semibold">{error ? '!' : data ? data.unreadCount : '…'}</span>
  </Link>;
}
