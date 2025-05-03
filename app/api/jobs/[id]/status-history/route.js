// app/api/jobs/[id]/status-history/route.js
import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongodb'
import Job from '@/lib/models/Job'
import StatusHistory from '@/lib/models/StatusHistory'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

// Get status history for a job
export async function GET(request, { params }) {
  await dbConnect()

  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // —— 关键改动：先 await params，再解构 id
    const { id: jobId } = await params

    console.log(
      `GET /api/jobs/${jobId}/status-history - Fetching status history`
    )

    const job = await Job.findById(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const statusHistory = await StatusHistory.find({ jobId }).sort({ date: 1 })
    return NextResponse.json({ statusHistory })
  } catch (error) {
    console.error(`GET /api/jobs/status-history - Error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Add a new status history entry
export async function POST(request, { params }) {
  await dbConnect()

  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // —— 关键改动：先 await params，再解构 id
    const { id: jobId } = await params

    const data = await request.json()
    console.log(
      `POST /api/jobs/${jobId}/status-history - Adding status history entry`
    )

    const job = await Job.findById(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const statusHistoryData = {
      jobId,
      status: data.status,
      date: data.date || new Date(),
      notes: data.notes || '',
      userId: session.user.id
    }
    if (data.status === 'interviewing' && data.interviewStage) {
      statusHistoryData.interviewStage = data.interviewStage
    }

    const statusHistory = await StatusHistory.create(statusHistoryData)
    job.status = data.status
    await job.save()

    return NextResponse.json({ statusHistory }, { status: 201 })
  } catch (error) {
    console.error(`POST /api/jobs/status-history - Error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
