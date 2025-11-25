// app/api/sync-settings/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import User from '@/lib/models/User';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET() {
  await dbConnect();
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const user = await User.findById(session.user.id).lean();
  return NextResponse.json({
    syncMode: user?.syncMode || 'semi',
    autoThreshold: user?.autoThreshold ?? 0.7,
  });
}

export async function PATCH(request) {
  await dbConnect();
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const body = await request.json();
  const update = {};
  if (body.syncMode && ['auto', 'semi', 'strict'].includes(body.syncMode)) {
    update.syncMode = body.syncMode;
  }
  if (
    body.autoThreshold !== undefined &&
    !Number.isNaN(Number(body.autoThreshold))
  ) {
    update.autoThreshold = Math.max(
      0,
      Math.min(1, Number(body.autoThreshold))
    );
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid updates' }, { status: 400 });
  }
  const user = await User.findByIdAndUpdate(session.user.id, update, {
    new: true,
  }).lean();
  return NextResponse.json({
    syncMode: user.syncMode,
    autoThreshold: user.autoThreshold,
  });
}
