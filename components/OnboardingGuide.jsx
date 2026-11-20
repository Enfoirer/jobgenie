'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Modal from './Modal';
import { OnboardingClient } from '@/lib/onboarding/browserClient';

const steps = [
  { title: 'Track your applications', description: 'Add a company and role, then update the status as your application moves forward.', detail: 'Your Job Board brings applications and their status history together.' },
  { title: 'Stay on top of deadlines', description: 'Save interview times and assessment deadlines in Calendar & To-do.', detail: 'Set reminder preferences to get a heads-up before an event.' },
  { title: 'Keep your documents together', description: 'Link the resume, cover letter and portfolio you used to each application.', detail: 'Open an application to find its documents and saved versions.' },
];

export default function OnboardingGuide({ userId }) {
  const pathname = usePathname();
  const router = useRouter();
  const [client] = useState(() => new OnboardingClient({ userId }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    try { client.storage = window.localStorage; } catch { /* Account persistence remains available. */ }
    void client.start();
    const refresh = () => { if (document.visibilityState === 'visible') void client.refresh(); };
    const storage = event => { if (event.key === client.key) refresh(); };
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    window.addEventListener('storage', storage); document.addEventListener('visibilitychange', refresh);
    return () => {
      client.stop(); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', refresh);
    };
  }, [client]);
  useEffect(() => {
    if (!state.eligible || state.open || pathname !== '/dashboard/jobs') return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible'
        || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [aria-busy="true"], [data-feedback-busy="true"]')
        || document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
      client.show();
    }, 500);
    return () => clearInterval(timer);
  }, [client, pathname, state.eligible, state.open]);
  return <>
    {state.notice && <aside role="status" data-onboarding-notice className="fixed bottom-4 left-4 z-40 max-w-sm rounded-lg border bg-white p-4 text-sm shadow-lg">
      <p>{state.notice}</p>
      <button type="button" disabled={state.saving} onClick={() => { void client.save(); }} className="mt-2 min-h-11 rounded px-3 text-blue-700 hover:bg-blue-50 disabled:opacity-50">{state.saving ? 'Saving…' : 'Retry saving guide choice'}</button>
      <button type="button" onClick={() => client.update({ notice: '' })} className="min-h-11 rounded px-3 hover:bg-gray-100">Dismiss</button>
    </aside>}
    {state.open && <Modal title="Welcome to JobGenie" onClose={() => { void client.finish('skipped'); }}>
      <GuideSteps onSkip={() => { void client.finish('skipped'); }} onComplete={() => { void client.finish('completed'); router.push('/dashboard/add'); }} />
    </Modal>}
  </>;
}

function GuideSteps({ onSkip, onComplete }) {
  const [step, setStep] = useState(0);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    const dialog = heading.current.closest('dialog');
    const containFocus = event => {
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', containFocus);
    return () => dialog.removeEventListener('keydown', containFocus);
  }, []);
  const current = steps[step];
  return <section data-onboarding-guide className="space-y-6">
    <p className="text-sm text-gray-500" aria-live="polite">Step {step + 1} of {steps.length}</p>
    <div className="space-y-3">
      <h3 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-gray-900 outline-none">{current.title}</h3>
      <p className="text-base leading-relaxed text-gray-700">{current.description}</p>
      <p className="text-sm leading-relaxed text-gray-600">{current.detail}</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <button type="button" onClick={onSkip} className="min-h-11 rounded px-3 text-gray-600 hover:bg-gray-100">Skip</button>
      <div className="flex flex-wrap gap-2">
        {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="min-h-11 rounded border px-4 py-2 hover:bg-gray-50">Back</button>}
        <button type="button" onClick={step === steps.length - 1 ? onComplete : () => setStep(step + 1)} className="min-h-11 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">{step === steps.length - 1 ? 'Create your first application' : 'Next'}</button>
      </div>
    </div>
  </section>;
}
