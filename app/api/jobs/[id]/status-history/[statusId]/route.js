// app/api/jobs/[id]/status-history/[statusId]/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Job from '@/lib/models/Job';
import StatusHistory from '@/lib/models/StatusHistory';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// Update a specific status history entry
export async function PATCH(request, { params }) {
  await dbConnect();

  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fix: await params before destructuring
    const paramsObj = await params;
    const { id: jobId, statusId } = paramsObj;
    
    const data = await request.json();
    
    console.log(`PATCH /api/jobs/${jobId}/status-history/${statusId} - Updating status history`);

    // First verify that the job exists and belongs to the user
    const job = await Job.findById(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Then find and update the status history entry
    const statusEntry = await StatusHistory.findById(statusId);
    if (!statusEntry) {
      return NextResponse.json({ error: 'Status history entry not found' }, { status: 404 });
    }
    
    if (statusEntry.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Update the status history entry
    const updatedStatus = await StatusHistory.findByIdAndUpdate(
      statusId,
      {
        status: data.status,
        interviewStage: data.interviewStage,
        date: data.date,
        notes: data.notes
      },
      { new: true }
    );

    // If this is the latest status entry, also update the job's current status
    const latestStatusEntry = await StatusHistory.findOne({ jobId })
      .sort({ date: -1 })
      .limit(1);
    
    if (latestStatusEntry && latestStatusEntry._id.toString() === statusId) {
      job.status = data.status;
      await job.save();
    }

    return NextResponse.json({ statusHistory: updatedStatus });
  } catch (error) {
    console.error(`PATCH /api/jobs/[id]/status-history/[statusId] - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Delete a specific status history entry
export async function DELETE(request, { params }) {
  await dbConnect();

  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fix: await params before destructuring
    const paramsObj = await params;
    const { id: jobId, statusId } = paramsObj;
    
    console.log(`DELETE /api/jobs/${jobId}/status-history/${statusId} - Deleting status history`);

    // First verify that the job exists and belongs to the user
    const job = await Job.findById(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Then find the status history entry
    const statusEntry = await StatusHistory.findById(statusId);
    if (!statusEntry) {
      return NextResponse.json({ error: 'Status history entry not found' }, { status: 404 });
    }
    
    if (statusEntry.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Delete the status history entry
    await StatusHistory.findByIdAndDelete(statusId);

    // If this was the latest status entry, update the job's current status to the previous entry
    const latestStatusEntry = await StatusHistory.findOne({ jobId })
      .sort({ date: -1 })
      .limit(1);
    
    if (latestStatusEntry) {
      job.status = latestStatusEntry.status;
      await job.save();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/jobs/[id]/status-history/[statusId] - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}