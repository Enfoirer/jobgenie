'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
export default function AdminFeedbackLink({ userId }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setAllowed(false);
    fetch('/api/admin/access', { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!controller.signal.aborted) setAllowed(response.ok); }).catch(() => {});
    return () => controller.abort();
  }, [userId]);
  return allowed ? <div className="flex flex-col text-xs"><Link href="/dashboard/admin/feedback" className="px-2 text-blue-700">Feedback review</Link><Link href="/dashboard/admin/errors" className="px-2 text-blue-700">Error monitoring</Link></div> : null;
}
