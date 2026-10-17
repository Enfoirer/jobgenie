import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { reviewPendingItem } from '@/lib/pipeline/pendingReview';

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    await dbConnect();
    const { id } = await params;
    const { action, updates } = await request.json();
    return NextResponse.json(await reviewPendingItem({
      id, userId: session.user.id, action, updates,
    }));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
