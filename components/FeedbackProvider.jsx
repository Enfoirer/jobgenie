'use client';

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import Modal from './Modal';
import { FeedbackClient, validDraft } from '@/lib/feedback/browserClient';

const FeedbackContext = createContext(null);
const rootPages = new Set(['/dashboard/jobs', '/dashboard/todo', '/dashboard/mail', '/dashboard/analytics']);

export default function FeedbackProvider({ userId, children }) {
  const pathname = usePathname();
  const path = useRef(pathname); path.current = pathname;
  const pointers = useRef(new Set());
  const [client] = useState(() => new FeedbackClient({ userId, onUnauthorized: () => {
    signOut({ callbackUrl: '/login' }).catch(() => window.location.assign('/login'));
  } }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    const activePointers = pointers.current;
    try { client.storage = window.localStorage; } catch { /* Account persistence still works when online. */ }
    try { client.sessionStorage = window.sessionStorage; } catch { /* Server limits remain authoritative. */ }
    client.locale = /^[a-zA-Z0-9._+-]{1,40}$/.test(navigator.language) ? navigator.language : 'en';
    client.start();
    const active = () => document.visibilityState === 'visible' && document.hasFocus();
    const safe = () => {
      const focused = document.activeElement;
      return rootPages.has(path.current) && activePointers.size === 0
        && !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [aria-busy="true"], [data-feedback-busy="true"]')
        && !focused?.matches('input, textarea, select, [contenteditable="true"]');
    };
    const tick = () => { void client.tick({ active, safe }); };
    const interaction = () => client.interact();
    const pointerDown = event => { activePointers.add(event.pointerId); interaction(); };
    const pointerUp = event => { activePointers.delete(event.pointerId); interaction(); };
    const visibility = () => { activePointers.clear(); client.clock.advance(client.now(), active()); interaction(); tick(); };
    const storage = event => { if (event.key === client.key) client.syncStorage(); };
    const events = ['click', 'keydown', 'input', 'scroll', 'wheel', 'focusin'];
    events.forEach(event => document.addEventListener(event, interaction, { capture: true, passive: true }));
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', pointerUp, true); document.addEventListener('pointercancel', pointerUp, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', visibility); window.addEventListener('blur', visibility);
    window.addEventListener('online', tick); window.addEventListener('storage', storage);
    tick(); const timer = setInterval(tick, 5000);
    return () => {
      clearInterval(timer); client.stop(); activePointers.clear();
      events.forEach(event => document.removeEventListener(event, interaction, true));
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', pointerUp, true); document.removeEventListener('pointercancel', pointerUp, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', visibility); window.removeEventListener('blur', visibility);
      window.removeEventListener('online', tick); window.removeEventListener('storage', storage);
    };
  }, [client]);
  useEffect(() => { client.interact(); }, [pathname, client]);
  return <FeedbackContext.Provider value={client}>
    {children}
    {state.notice && <div role="status" data-feedback-notice className="fixed bottom-4 left-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border bg-white px-4 py-2 text-sm text-gray-800 shadow-lg">
      <p>{state.notice}</p><button type="button" aria-label="Dismiss feedback notice" className="min-h-11 min-w-11 rounded hover:bg-gray-100" onClick={() => client.update({ notice: '' })}>×</button>
    </div>}
    {state.open && <Modal title="Rate JobGenie" busy={state.busy} onClose={() => { void client.dismiss(); }}>
      <FeedbackForm key={state.formId} client={client} state={state} />
    </Modal>}
  </FeedbackContext.Provider>;
}

export function FeedbackButton() {
  const client = useContext(FeedbackContext);
  return <button type="button" aria-label="Rate JobGenie" title="Share product feedback" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded px-2 text-sm text-blue-700 hover:bg-blue-50"
    onClick={() => { if (!document.querySelector('dialog[open]')) void client?.openManual(); }}>
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>
    <span className="hidden lg:inline">Feedback</span>
  </button>;
}

function Rating({ name, title, endpoints, value, onChange, disabled }) {
  return <fieldset disabled={disabled} data-feedback-rating={name} className="min-w-0 rounded-lg border p-4">
    <legend className="px-1 font-medium text-gray-900">{title}</legend>
    <div className="flex flex-wrap gap-1">
      {[1, 2, 3, 4, 5].map(star => <label key={star} className="relative cursor-pointer">
        <input type="radio" name={name} value={star} checked={value === star} onChange={() => onChange(star)} required aria-label={`${star} out of 5 stars`} className="peer sr-only" />
        <span className={`flex min-h-11 min-w-11 items-center justify-center rounded peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 ${star <= (value || 0) ? 'text-blue-600' : 'text-gray-400'}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8" fill={star <= (value || 0) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>
        </span>
      </label>)}
    </div>
    <p className="mt-2 text-sm text-gray-600">{endpoints}</p>
  </fieldset>;
}
function FeedbackForm({ client, state }) {
  const [draft, setDraft] = useState({ overall: null, recommendation: null, comment: '' });
  const ref = useRef(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (ref.current?.closest('dialog')?.open) void client.shown().catch(() => {}); });
    return () => cancelAnimationFrame(frame);
  }, [client]);
  const submitted = state.status?.submitted || client.preference?.action === 'submitted';
  return <form ref={ref} data-feedback-form className="space-y-5" onSubmit={event => { event.preventDefault(); void client.submit(draft); }}>
    {submitted ? <section className="space-y-3" data-feedback-received>
      <h3 className="font-medium">Your feedback for this survey has been received. Thank you.</h3>
      <p className="text-sm text-gray-600">You will not receive more automatic invitations for this survey.</p>
      {state.status?.response && <div className="space-y-2 rounded border p-3 text-sm">
        <p>Overall satisfaction: {state.status.response.overall}/5</p>
        <p>Recommendation: {state.status.response.recommendation}/5</p>
        {state.status.response.comment && <p className="whitespace-pre-wrap break-words">{state.status.response.comment}</p>}
      </div>}
    </section> : <>
      <p className="text-sm text-gray-600">This is product feedback for JobGenie. There is no right answer, and your response will not affect your applications or service.</p>
      {state.loading && <p role="status" className="text-sm text-gray-600">Loading your previous feedback…</p>}
      <Rating name="overall" title="Overall, how satisfied are you with JobGenie?" endpoints="1 star: very dissatisfied. 5 stars: very satisfied."
        value={draft.overall} onChange={overall => setDraft(previous => ({ ...previous, overall }))} disabled={state.busy} />
      <Rating name="recommendation" title="How likely are you to recommend JobGenie to a friend?" endpoints="1 star: very unlikely. 5 stars: very likely."
        value={draft.recommendation} onChange={recommendation => setDraft(previous => ({ ...previous, recommendation }))} disabled={state.busy} />
      <div>
        <label htmlFor="feedback-comment" className="block font-medium">Any suggestions or other feedback? <span className="font-normal text-gray-600">(Optional)</span></label>
        <textarea id="feedback-comment" name="comment" rows={4} maxLength={2000} disabled={state.busy} value={draft.comment} onChange={event => setDraft(previous => ({ ...previous, comment: event.target.value }))}
          aria-describedby="feedback-comment-count" className="mt-2 w-full rounded border border-gray-300 p-3 focus:border-blue-500 focus:ring-blue-500" />
        <p id="feedback-comment-count" className="text-right text-xs text-gray-500">{draft.comment.length}/2000</p>
      </div>
      <p className="text-xs text-gray-600">Feedback is saved with your account, platform, app version and language for product analysis. We also record invitation and skip choices. Please do not include passwords, email contents or other sensitive information.</p>
    </>}
    {state.error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    <div className="flex flex-wrap gap-3">
      {!submitted && <button type="submit" disabled={!validDraft(draft) || state.busy || state.loading} className="min-h-11 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">{state.busy ? 'Sending feedback…' : 'Send feedback'}</button>}
      <button type="button" disabled={state.busy} onClick={() => { void client.dismiss(); }} className="min-h-11 rounded border px-4 py-2 disabled:opacity-50">{submitted ? 'Close' : 'Not now'}</button>
    </div>
    <div className="border-t pt-3">
      <button type="button" disabled={state.busy} onClick={() => { void client.dismiss('never'); }} className="min-h-11 text-sm text-gray-700 underline disabled:opacity-50">Never show automatically again</button>
      <p className="text-xs text-gray-500">You can still share feedback using the Feedback button after turning invitations off.</p>
    </div>
  </form>;
}
