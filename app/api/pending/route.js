// app/api/pending/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import PendingItem from '@/lib/models/PendingItem';

export async function GET(request) {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');

  const statusFilter =
    statusParam && ['pending', 'accepted', 'ignored', 'all'].includes(statusParam)
      ? statusParam
      : 'pending';

  const query = { userId: session.user.id };
  if (statusFilter !== 'all') {
    query.status = statusFilter;
  }

  const items = await PendingItem.find(query).sort({ createdAt: -1 }).lean();

  return NextResponse.json({ items });
}
