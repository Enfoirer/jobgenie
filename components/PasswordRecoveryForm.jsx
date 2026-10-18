'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function PasswordRecoveryForm({ reset = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!reset) return;
    const readLink = () => {
      setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
      setMessage(''); setError(''); setPassword(''); setConfirmation('');
    };
    readLink();
    window.addEventListener('hashchange', readLink);
    return () => window.removeEventListener('hashchange', readLink);
  }, [reset]);
  const invalidToken = reset && token !== null && !/^[a-f0-9]{24}\.[a-f0-9]{64}$/.test(token);

  async function submit(event) {
    event.preventDefault(); setError(''); setMessage('');
    if (reset && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${reset ? 'reset-password' : 'forgot-password'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { token, password } : { email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to complete this request.');
      setMessage(data.message);
      if (reset) { setPassword(''); setConfirmation(''); window.history.replaceState(null, '', window.location.pathname); }
    } catch (err) { setError(err.message || 'Unable to complete this request. Please try again.'); }
    finally { setBusy(false); }
  }

  const inputClass = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2';
  return <main className="min-h-screen bg-gray-50 px-4 py-16">
    <div className="mx-auto max-w-md rounded-lg bg-white p-8 shadow">
      <h1 className="text-2xl font-semibold">{reset ? 'Reset password' : 'Forgot your password?'}</h1>
      <p className="mt-2 text-sm text-gray-600">{reset ? 'Choose a new password with at least 8 characters (at most 72 UTF-8 bytes). Your previous sessions will be signed out.' : 'Enter your sign-in email address. Reset links are valid for 30 minutes and can be used once.'}</p>
      {(error || invalidToken) && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error || 'This reset link is invalid. Request a new link.'}</p>}
      {message && <p role="status" className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {!(reset && message) && !invalidToken && <form onSubmit={submit} className="mt-6 space-y-4">
        {reset ? <>
          <div><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></div>
          <div><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={inputClass} /></div>
        </> : <div><label htmlFor="recovery-email">Email address</label><input id="recovery-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></div>}
        <button disabled={busy || (reset && token === null)} className="w-full rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Please wait…' : reset ? 'Update password' : 'Send reset link'}</button>
      </form>}
      {reset && !message && <Link href="/forgot-password" className="mt-4 block text-sm text-blue-700">Request a new reset link</Link>}
      <Link href="/login" className="mt-4 block text-sm text-blue-700">Back to sign in</Link>
    </div>
  </main>;
}
