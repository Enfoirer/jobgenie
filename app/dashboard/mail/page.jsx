// app/dashboard/mail/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OUTLOOK_AUTH_BASE = 'https://login.microsoftonline.com';
const GOOGLE_SCOPE =
  'https://www.googleapis.com/auth/gmail.readonly openid email profile';
const OUTLOOK_SCOPE =
  'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access openid profile email';

export default function MailConnectionsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const searchParams = useSearchParams();

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected === 'gmail') {
      setSuccess('已连接 Gmail');
    } else if (connected === 'outlook') {
      setSuccess('已连接 Outlook');
    }
  }, [searchParams]);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/mail/accounts');
      if (!res.ok) {
        throw new Error('加载邮箱授权信息失败');
      }
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const connectGoogle = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError('缺少 NEXT_PUBLIC_GOOGLE_CLIENT_ID 配置');
      return;
    }
    const redirectUri = `${window.location.origin}/api/oauth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPE,
      include_granted_scopes: 'true',
    });
    window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  };

  const connectOutlook = () => {
    const clientId = process.env.NEXT_PUBLIC_OUTLOOK_CLIENT_ID;
    if (!clientId) {
      setError('缺少 NEXT_PUBLIC_OUTLOOK_CLIENT_ID 配置');
      return;
    }
    const tenant = process.env.NEXT_PUBLIC_OUTLOOK_TENANT_ID || 'common';
    const redirectUri = `${window.location.origin}/api/oauth/outlook/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: OUTLOOK_SCOPE,
      prompt: 'select_account',
    });
    window.location.href = `${OUTLOOK_AUTH_BASE}/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  };

  return (
    <div className="max-w-3xl">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">邮箱授权</h1>
        <p className="mt-1 text-sm text-gray-500">
          连接 Gmail/Outlook 后，系统即可读取你的求职相关邮件。
        </p>
      </div>

      {(error || success) && (
        <div className="mt-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
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

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="text-lg font-medium text-gray-800">连接 Gmail</h3>
          <p className="mt-2 text-sm text-gray-600">
            需开启 Gmail API 并在 Google Console 配置 Redirect URI。
          </p>
          <button
            onClick={connectGoogle}
            className="mt-4 inline-flex w-full justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            连接 Gmail
          </button>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="text-lg font-medium text-gray-800">连接 Outlook</h3>
          <p className="mt-2 text-sm text-gray-600">
            使用 Microsoft Graph Mail.Read 权限，支持个人或工作账号。
          </p>
          <button
            onClick={connectOutlook}
            className="mt-4 inline-flex w-full justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            连接 Outlook
          </button>
        </div>
      </div>

      <div className="mt-8">
                <h2 className="text-lg font-medium text-gray-800">已连接的邮箱</h2>
                {loading ? (
                  <div className="mt-3 text-sm text-gray-500">加载中...</div>
                ) : accounts.length === 0 ? (
                  <div className="mt-3 text-sm text-gray-500">暂无已连接邮箱</div>
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
                              令牌过期：{new Date(acc.expiresAt).toLocaleString()}
                            </p>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/mail/accounts/${acc.id}`, {
                                  method: 'DELETE',
                                });
                                if (!res.ok) {
                                  throw new Error('断开失败');
                                }
                                fetchAccounts();
                              } catch (e) {
                                setError(e.message || '断开失败');
                              }
                            }}
                            className="inline-flex items-center rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            断开
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
    </div>
  );
}
