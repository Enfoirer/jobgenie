// app/api/pending/[id]/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import PendingItem from '@/lib/models/PendingItem';
import Job from '@/lib/models/Job';
import StatusHistory from '@/lib/models/StatusHistory';
import { COLUMNS } from '@/lib/mockData';

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
  const statusMap = {
    submission: COLUMNS.APPLIED,
    oa: COLUMNS.INTERVIEWING,
    interview: COLUMNS.INTERVIEWING,
    rejection: COLUMNS.REJECTED,
    offer: COLUMNS.OFFER,
    other: COLUMNS.APPLIED,
  };

  const targetStatus = statusMap[item.eventType] || COLUMNS.APPLIED;

  // Try to find existing job by company/position; fallback create
  let job = null;
  if (item.company || item.position) {
    job = await Job.findOne({
      userId: session.user.id,
      ...(item.company ? { company: item.company } : {}),
      ...(item.position ? { position: item.position } : {}),
    });
  }

  if (!job) {
    job = await Job.create({
      userId: session.user.id,
      company: item.company || 'Unknown Company',
      position: item.position || 'Unknown Position',
      status: targetStatus,
      notes: item.subject || '',
      dateApplied: item.receivedAt || new Date(),
      applicationSource: 'Email',
    });
  } else {
    job.status = targetStatus;
    job.notes = item.subject || job.notes;
    await job.save();
  }

  await StatusHistory.create({
    jobId: job._id,
    status: targetStatus,
    date: item.receivedAt || new Date(),
    notes: item.snippet || '',
    userId: session.user.id,
  });

  item.status = 'accepted';
  await item.save();

  return NextResponse.json({ success: true, item, jobId: job._id });
}
