// app/api/jobs/[id]/status-history/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Job from '@/lib/models/Job';
import StatusHistory from '@/lib/models/StatusHistory';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// Get status history for a job
export async function GET(request, { params }) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { id } = params;
    
    console.log(`GET /api/jobs/${id}/status-history - Fetching status history`);
    
    // Find job and verify ownership
    const job = await Job.findById(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    // Get status history
    const statusHistory = await StatusHistory.find({ jobId: id }).sort({ date: 1 });
    
    return NextResponse.json({ statusHistory });
  } catch (error) {
    console.error(`GET /api/jobs/${id}/status-history - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Add a new status history entry
export async function POST(request, { params }) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { id } = params;
    const data = await request.json();
    
    console.log(`POST /api/jobs/${id}/status-history - Adding status history entry`);
    
    // Find job and verify ownership
    const job = await Job.findById(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    // Create new status history entry
    const statusHistory = await StatusHistory.create({
      jobId: id,
      status: data.status,
      date: data.date || new Date(),
      notes: data.notes || '',
      userId: session.user.id
    });
    
    // Update job's status to match the latest status history entry
    job.status = data.status;
    await job.save();
    
    return NextResponse.json({ statusHistory }, { status: 201 });
  } catch (error) {
    console.error(`POST /api/jobs/${id}/status-history - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}