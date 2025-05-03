// app/api/jobs/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Job from '@/lib/models/Job';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request) {
  try {
    await dbConnect();
    console.log('GET /api/jobs - Connected to database');
    
    const session = await getServerSession(authOptions);
    
    if (!session) {
      console.log('GET /api/jobs - Not authenticated');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    console.log('GET /api/jobs - Authenticated as', session.user.email);
    console.log('GET /api/jobs - User ID:', session.user.id);
    
    const userJobs = await Job.find({ userId: session.user.id }).sort({ createdAt: -1 });
    console.log(`GET /api/jobs - Found ${userJobs.length} jobs`);
    
    return NextResponse.json({ jobs: userJobs });
  } catch (error) {
    console.error('GET /api/jobs - Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await dbConnect();
    console.log('POST /api/jobs - Connected to database');
    
    const session = await getServerSession(authOptions);
    
    if (!session) {
      console.log('POST /api/jobs - Not authenticated');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    console.log('POST /api/jobs - Authenticated as', session.user.email);
    
    const data = await request.json();
    console.log('POST /api/jobs - Received data:', data);
    
    // Make sure we have the userId
    const newJob = {
      ...data,
      userId: session.user.id
    };
    
    const job = await Job.create(newJob);
    console.log('POST /api/jobs - Created job:', job._id);
    
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error('POST /api/jobs - Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}