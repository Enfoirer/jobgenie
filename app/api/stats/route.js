// app/api/stats/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import StatusHistory from '@/lib/models/StatusHistory';
import Job from '@/lib/models/Job';
import { COLUMNS } from '@/lib/mockData';

export async function GET(request) {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.max(
    1,
    Math.min(90, Number(searchParams.get('days')) || 7)
  );
  const since = new Date();
  since.setDate(since.getDate() - days + 1);

  // Timeline: count events per day per status
  const histories = await StatusHistory.find({
    userId: session.user.id,
    date: { $gte: since },
  }).lean();

  const timeline = {};
  histories.forEach((h) => {
    const day = new Date(h.date);
    const key = day.toISOString().slice(0, 10);
    if (!timeline[key]) timeline[key] = { applied: 0, interviewing: 0, offer: 0, rejected: 0 };
    timeline[key][h.status] = (timeline[key][h.status] || 0) + 1;
  });

  // Funnel: latest status per job
  const jobs = await Job.find({ userId: session.user.id }).lean();
  const statusOrder = [COLUMNS.APPLIED, COLUMNS.INTERVIEWING, COLUMNS.OFFER, COLUMNS.REJECTED];
  const latestByJob = {};
  histories.forEach((h) => {
    if (!latestByJob[h.jobId]) latestByJob[h.jobId] = h;
    else if (new Date(h.date) > new Date(latestByJob[h.jobId].date)) latestByJob[h.jobId] = h;
  });
  jobs.forEach((j) => {
    if (!latestByJob[j._id]) latestByJob[j._id] = { status: j.status };
  });

  const funnelCounts = statusOrder.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {});
  Object.values(latestByJob).forEach((h) => {
    funnelCounts[h.status] = (funnelCounts[h.status] || 0) + 1;
  });

  return NextResponse.json({
    timeline,
    funnel: funnelCounts,
  });
}
