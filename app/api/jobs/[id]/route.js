// app/api/jobs/[id]/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Job from '@/lib/models/Job';
import StatusHistory from '@/lib/models/StatusHistory';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// Get a specific job
export async function GET(request, { params }) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { id } = params;
    
    console.log(`GET /api/jobs/${id} - Fetching job`);
    
    // Find job and verify ownership
    const job = await Job.findById(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    return NextResponse.json({ job });
  } catch (error) {
    console.error(`GET /api/jobs/[id] - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Update a job
export async function PATCH(request, { params }) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { id } = params;
    const data = await request.json();
    
    console.log(`PATCH /api/jobs/${id} - Updating job`);
    
    // Find job and verify ownership
    const job = await Job.findById(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    // If status is being updated, add a status history entry
    if (data.status && data.status !== job.status) {
      console.log(`PATCH /api/jobs/${id} - Status changing from ${job.status} to ${data.status}`);
      
      // Create a status history entry
      await StatusHistory.create({
        jobId: id,
        status: data.status,
        date: data.date || new Date(),
        notes: data.notes || '',
        userId: session.user.id
      });
      
      console.log(`PATCH /api/jobs/${id} - Status history entry created`);
    }
    
    // Update job
    const updatedJob = await Job.findByIdAndUpdate(id, data, { new: true });
    
    return NextResponse.json({ job: updatedJob });
  } catch (error) {
    console.error(`PATCH /api/jobs/[id] - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Delete a job
export async function DELETE(request, { params }) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { id } = params;
    
    console.log(`DELETE /api/jobs/${id} - Deleting job`);
    
    // Find job and verify ownership
    const job = await Job.findById(id);
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    // Delete job
    await Job.findByIdAndDelete(id);
    
    // Delete all status history entries for this job
    await StatusHistory.deleteMany({ jobId: id });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/jobs/[id] - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}