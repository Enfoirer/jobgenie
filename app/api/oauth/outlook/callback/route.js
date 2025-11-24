// app/api/oauth/outlook/callback/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const OUTLOOK_TOKEN_ENDPOINT = (tenant) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const GRAPH_ME_ENDPOINT = 'https://graph.microsoft.com/v1.0/me';
const DEFAULT_TENANT = process.env.OUTLOOK_TENANT_ID || 'common';

function getRedirectUri(request) {
  const envBase =
    process.env.NEXTAUTH_URL || process.env.OAUTH_REDIRECT_BASE || '';
  const base =
    envBase.trim() !== ''
      ? envBase.replace(/\/$/, '')
      : new URL(request.url).origin;
  return `${base}/api/oauth/outlook/callback`;
}

export async function GET(request) {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.json(
      { error: `Outlook OAuth error: ${error}` },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 }
    );
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Server is missing Outlook OAuth credentials' },
      { status: 500 }
    );
  }

  const redirectUri = getRedirectUri(request);
  const tenant = DEFAULT_TENANT;

  // Exchange code for tokens
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('code', code);
  params.set('grant_type', 'authorization_code');
  params.set('redirect_uri', redirectUri);
  params.set(
    'scope',
    'https://graph.microsoft.com/Mail.Read offline_access openid profile email'
  );

  const tokenRes = await fetch(OUTLOOK_TOKEN_ENDPOINT(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return NextResponse.json(
      {
        error: `Failed to exchange code: ${tokenRes.status} ${tokenRes.statusText}`,
        details: text,
      },
      { status: 500 }
    );
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : undefined;

  if (!accessToken) {
    return NextResponse.json(
      { error: 'Outlook did not return an access token' },
      { status: 500 }
    );
  }

  // Fetch email address
  const profileRes = await fetch(GRAPH_ME_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!profileRes.ok) {
    const text = await profileRes.text();
    return NextResponse.json(
      {
        error: `Failed to fetch profile: ${profileRes.status} ${profileRes.statusText}`,
        details: text,
      },
      { status: 500 }
    );
  }

  const profile = await profileRes.json();
  const emailAddress =
    profile.mail ||
    profile.userPrincipalName ||
    profile.preferred_username ||
    '';

  if (!emailAddress) {
    return NextResponse.json(
      { error: 'Could not determine Outlook address' },
      { status: 500 }
    );
  }

  // Save or update MailAccount
  const existing = await MailAccount.findOne({
    provider: 'outlook',
    userId: session.user.id,
    emailAddress: emailAddress.toLowerCase(),
  });

  if (existing) {
    existing.accessToken = accessToken;
    existing.scope = tokenData.scope || existing.scope;
    existing.expiresAt = expiresAt || existing.expiresAt;
    if (refreshToken) {
      existing.refreshToken = refreshToken;
    }
    await existing.save();
  } else {
    await MailAccount.create({
      provider: 'outlook',
      emailAddress: emailAddress.toLowerCase(),
      accessToken,
      refreshToken,
      expiresAt,
      scope: tokenData.scope,
      userId: session.user.id,
    });
  }

  const redirectTarget = new URL('/dashboard/mail?connected=outlook', request.url);
  return NextResponse.redirect(redirectTarget);
}
