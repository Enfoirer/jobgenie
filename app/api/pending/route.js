// app/api/pending/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import PendingItem from '@/lib/models/PendingItem';

export async function GET() {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const items = await PendingItem.find({ userId: session.user.id, status: 'pending' })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({ items });
}
