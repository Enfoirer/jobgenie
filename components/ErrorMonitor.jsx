'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { installBrowserMonitoring } from '@/lib/monitoring/browser';
export default function ErrorMonitor() {
  const { data } = useSession();
  const [notice, setNotice] = useState(null);
  useEffect(() => { setNotice(null); return installBrowserMonitoring(setNotice, data?.user?.id); }, [data?.user?.id]);
  return notice ? <aside role="alert" className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border bg-white p-4 text-sm shadow-lg sm:left-auto sm:max-w-md">
    <p>Something went wrong. Share this reference with support.</p><p className="my-2 break-all font-mono">{notice}</p>
    <button className="rounded border px-3 py-1" onClick={() => setNotice(null)}>Dismiss</button>
  </aside> : null;
}
