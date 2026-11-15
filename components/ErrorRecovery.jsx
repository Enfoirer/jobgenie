'use client';
import { useEffect, useState } from 'react';
import { reportBrowserError } from '@/lib/monitoring/browser';
export default function ErrorRecovery({ error, reset }) {
  const [reference, setReference] = useState(null);
  useEffect(() => { let active = true; reportBrowserError('render_error', { digest: error?.digest }).then(id => { if (active) setReference(id); }); return () => { active = false; }; }, [error]);
  return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-semibold">Unable to display this page</h1>
    {reference ? <p className="my-4 break-all">Share reference {reference} with support.</p> : <p className="my-4">Please retry. A diagnostic reference may be unavailable while disconnected or signed out.</p>}
    <button className="rounded border px-4 py-2" onClick={reset}>Try again</button></main>;
}
