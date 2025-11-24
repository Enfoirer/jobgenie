// app/api/mail/accounts/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET() {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const accounts = await MailAccount.find(
    { userId: session.user.id },
    {
      accessToken: 0,
      refreshToken: 0,
      scope: 0,
      __v: 0,
    }
  ).sort({ createdAt: -1 });

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      id: a._id,
      provider: a.provider,
      emailAddress: a.emailAddress,
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
  });
}
