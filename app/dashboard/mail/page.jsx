// app/dashboard/mail/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import MailSyncPanel from '@/components/MailSyncPanel';
import SyncSettingsPanel from '@/components/SyncSettingsPanel';

export default function MailConnectionsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [connecting, setConnecting] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    const messages = {
      invalid_state: 'This mailbox authorization is invalid or expired. Start Connect again.',
      cancelled: 'Mailbox connection was cancelled. You can try again.',
      failed: 'Unable to connect your mailbox. Please start Connect again.',
      session_expired: 'Your sign-in changed or expired. Sign in again and restart the connection.',
    };
    setError(messages[searchParams.get('oauth_error')] || '');
    const connected = searchParams.get('connected');
    if (connected === 'gmail') {
      setSuccess('Gmail connected');
    } else if (connected === 'outlook') {
      setSuccess('Outlook connected');
    }
  }, [searchParams]);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/mail/accounts');
      if (!res.ok) {
        throw new Error('Failed to load mail accounts');
      }
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const connectMailbox = async (provider) => {
    setConnecting(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/oauth/${provider}/start`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to start mailbox connection.');
      window.location.assign(data.url);
    } catch (err) {
      setError(err.message || 'Unable to start mailbox connection.');
      setConnecting(false);
    }
  };

  return (
    <div className="max-w-5xl px-4 sm:px-0">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">Mail Connections</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect Gmail/Outlook to read job-related emails.
        </p>
      </div>

      {(error || success) && (
        <div className="mt-4">
          {error && (
            <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              {success}
            </div>
          )}
        </div>
      )}

      <MailSyncPanel accountVersion={accounts.map((a) => a.id).join(',')} />

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="text-lg font-medium text-gray-800">Connect Gmail</h3>
          <p className="mt-2 text-sm text-gray-600">
            Authorize read-only access to your Gmail inbox.
          </p>
          <button
            disabled={connecting}
            onClick={() => connectMailbox('google')}
            className="mt-4 inline-flex w-full justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Connect Gmail
          </button>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="text-lg font-medium text-gray-800">Connect Outlook</h3>
          <p className="mt-2 text-sm text-gray-600">
            Uses Microsoft Graph Mail.Read, supports personal or work accounts.
          </p>
          <button
            disabled={connecting}
            onClick={() => connectMailbox('outlook')}
            className="mt-4 inline-flex w-full justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Connect Outlook
          </button>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-800">Connected accounts</h2>
        {loading ? (
          <div className="mt-3 text-sm text-gray-500">Loading...</div>
        ) : accounts.length === 0 ? (
          <div className="mt-3 text-sm text-gray-500">No connected accounts</div>
        ) : (
          <ul className="mt-3 divide-y divide-gray-200 rounded-md border bg-white">
            {accounts.map((acc) => (
              <li key={acc.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {acc.emailAddress}
                          </p>
                          <p className="text-xs text-gray-500 uppercase">{acc.provider}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {acc.expiresAt && (
                            <p className="text-xs text-gray-500">
                              Expires: {new Date(acc.expiresAt).toLocaleString()}
                            </p>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/mail/accounts/${acc.id}`, {
                                  method: 'DELETE',
                                });
                                if (!res.ok) {
                                  throw new Error('Disconnect failed');
                                }
                                fetchAccounts();
                              } catch (e) {
                                setError(e.message || 'Disconnect failed');
                              }
                            }}
                            className="inline-flex items-center rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            Disconnect
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
        )}
      </div>

      <div className="mt-8">
        <SyncSettingsPanel />
      </div>
    </div>
  );
}
