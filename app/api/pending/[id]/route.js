// app/api/pending/[id]/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import PendingItem from '@/lib/models/PendingItem';
import { applyEventToJob } from '@/lib/pipeline/jobUpdater';

export async function PATCH(request, { params }) {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = params;
  const body = await request.json();
  const action = body.action; // 'accept' | 'ignore' | 'edit'

  const item = await PendingItem.findById(id);
  if (!item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (item.userId.toString() !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  if (action === 'ignore') {
    item.status = 'ignored';
    await item.save();
    return NextResponse.json({ success: true, item });
  }

  // Merge edits if provided
  if (body.updates) {
    Object.assign(item, body.updates);
  }

  // Accept: create/update Job and StatusHistory
  const isInterviewLike = item.eventType === 'oa' || item.eventType === 'interview';
  const eventDate = isInterviewLike
    ? item.interviewTime || item.receivedAt || new Date()
    : item.receivedAt || new Date();

  const job = await applyEventToJob({
    userId: session.user.id,
    company: item.company,
    position: item.position,
    eventType: item.eventType,
    subject: item.subject,
    snippet: item.snippet,
    receivedAt: eventDate,
  });

  item.status = 'accepted';
  await item.save();

  return NextResponse.json({ success: true, item, jobId: job._id });
}
