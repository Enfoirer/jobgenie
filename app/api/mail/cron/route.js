import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import { syncMailAccounts } from '@/lib/pipeline/mailSync';

export async function GET(request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get('token') !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await dbConnect();
    const provider = url.searchParams.get('provider');
    const value = Number(url.searchParams.get('limit'));
    const limit = Number.isInteger(value) && value > 0 ? Math.min(value, 50) : 10;
    const accounts = await MailAccount.find(provider ? { provider } : {});
    return NextResponse.json(await syncMailAccounts(accounts, { limit }));
  } catch (error) {
    console.error('GET /api/mail/cron - Error:', error);
    return NextResponse.json(
      { error: 'Failed to sync mail', details: error.message }, { status: 500 }
    );
  }
}
