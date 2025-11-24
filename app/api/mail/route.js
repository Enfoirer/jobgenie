// app/api/mail/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import { fetchGmailMessages } from '@/lib/mail/gmail';
import { fetchOutlookMessages } from '@/lib/mail/outlook';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request) {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider');
  const limitParam = searchParams.get('limit');
  const limit = Number.isInteger(Number(limitParam))
    ? Math.min(Number(limitParam), 50)
    : 10;

  try {
    const query = { userId: session.user.id };
    if (provider) {
      query.provider = provider;
    }

    const accounts = await MailAccount.find(query);
    if (accounts.length === 0) {
      return NextResponse.json({ emails: [], accounts: [] });
    }

    const results = [];
    const errors = [];

    for (const account of accounts) {
      try {
        if (account.provider === 'gmail') {
          const messages = await fetchGmailMessages(account, { limit });
          results.push(
            ...messages.map((m) => ({
              ...m,
              accountId: account._id,
              emailAddress: account.emailAddress,
            }))
          );
        } else if (account.provider === 'outlook') {
          const messages = await fetchOutlookMessages(account, { limit });
          results.push(
            ...messages.map((m) => ({
              ...m,
              accountId: account._id,
              emailAddress: account.emailAddress,
            }))
          );
        }
      } catch (err) {
        console.error(
          `Failed to fetch messages for ${account.provider} (${account.emailAddress}):`,
          err
        );
        errors.push({
          provider: account.provider,
          emailAddress: account.emailAddress,
          message: err.message,
        });
      }
    }

    return NextResponse.json({ emails: results, errors });
  } catch (error) {
    console.error('GET /api/mail - Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mail', details: error.message },
      { status: 500 }
    );
  }
}
