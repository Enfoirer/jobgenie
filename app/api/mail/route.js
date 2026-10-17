import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { syncMailAccounts } from '@/lib/pipeline/mailSync';

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    const value = Number(searchParams.get('limit'));
    const limit = Number.isInteger(value) && value > 0 ? Math.min(value, 50) : 10;
    const query = { userId: session.user.id };
    if (provider) query.provider = provider;
    const accounts = await MailAccount.find(query);
    return NextResponse.json(await syncMailAccounts(accounts, { limit }));
  } catch (error) {
    console.error('GET /api/mail - Error:', error);
    return NextResponse.json(
      { error: 'Failed to sync mail', details: error.message }, { status: 500 }
    );
  }
}
