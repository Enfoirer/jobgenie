// app/api/oauth/google/callback/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_PROFILE_ENDPOINT = 'https://www.googleapis.com/gmail/v1/users/me/profile';

function getRedirectUri(request) {
  const envBase =
    process.env.NEXTAUTH_URL || process.env.OAUTH_REDIRECT_BASE || '';
  const base =
    envBase.trim() !== ''
      ? envBase.replace(/\/$/, '')
      : new URL(request.url).origin;
  return `${base}/api/oauth/google/callback`;
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
      { error: `Google OAuth error: ${error}` },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 }
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Server is missing Google OAuth credentials' },
      { status: 500 }
    );
  }

  const redirectUri = getRedirectUri(request);

  // Exchange code for tokens
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('code', code);
  params.set('grant_type', 'authorization_code');
  params.set('redirect_uri', redirectUri);

  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
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
      { error: 'Google did not return an access token' },
      { status: 500 }
    );
  }

  // Fetch email address
  const profileRes = await fetch(GOOGLE_PROFILE_ENDPOINT, {
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
  const emailAddress = profile.emailAddress;
  if (!emailAddress) {
    return NextResponse.json(
      { error: 'Could not determine Gmail address' },
      { status: 500 }
    );
  }

  // Save or update MailAccount
  const existing = await MailAccount.findOne({
    provider: 'gmail',
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
      provider: 'gmail',
      emailAddress: emailAddress.toLowerCase(),
      accessToken,
      refreshToken,
      expiresAt,
      scope: tokenData.scope,
      userId: session.user.id,
    });
  }

  const redirectTarget = new URL('/dashboard/mail?connected=gmail', request.url);
  return NextResponse.redirect(redirectTarget);
}
