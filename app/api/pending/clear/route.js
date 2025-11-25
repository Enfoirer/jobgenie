// app/api/pending/clear/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import PendingItem from '@/lib/models/PendingItem';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function POST(request) {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const allowed = ['accepted', 'ignored', 'all'];

  if (!status || !allowed.includes(status)) {
    return NextResponse.json(
      { error: 'status must be accepted|ignored|all' },
      { status: 400 }
    );
  }

  const query = { userId: session.user.id };
  if (status !== 'all') {
    query.status = status;
  } else {
    query.status = { $in: ['accepted', 'ignored'] };
  }

  const result = await PendingItem.deleteMany(query);

  return NextResponse.json({ success: true, deleted: result.deletedCount || 0 });
}
