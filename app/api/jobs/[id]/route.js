// app/api/jobs/[id]/route.js
import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongodb'
import Job from '@/lib/models/Job'
import StatusHistory from '@/lib/models/StatusHistory'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

// Get a specific job
export async function GET(request, { params }) {
  await dbConnect()

  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // —— 关键改动：先 await params，再解构 id
    const { id: jobId } = await params

    console.log(`GET /api/jobs/${jobId} - Fetching job`)

    const job = await Job.findById(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    return NextResponse.json({ job })
  } catch (error) {
    console.error(`GET /api/jobs/[id] - Error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Update a job
export async function PATCH(request, { params }) {
  await dbConnect()

  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // —— 关键改动：先 await params，再解构 id
    const { id: jobId } = await params

    const data = await request.json()
    console.log(`PATCH /api/jobs/${jobId} - Updating job`)

    const job = await Job.findById(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // 如果状态变更，创建一条状态历史
    if (data.status && data.status !== job.status) {
      console.log(
        `PATCH /api/jobs/${jobId} - Status changing from ${job.status} to ${data.status}`
      )
      await StatusHistory.create({
        jobId,
        status: data.status,
        date: data.date || new Date(),
        notes: data.notes || '',
        userId: session.user.id
      })
      console.log(`PATCH /api/jobs/${jobId} - Status history entry created`)
    }

    const updatedJob = await Job.findByIdAndUpdate(jobId, data, { new: true })
    return NextResponse.json({ job: updatedJob })
  } catch (error) {
    console.error(`PATCH /api/jobs/[id] - Error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Delete a job
export async function DELETE(request, { params }) {
  await dbConnect()

  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // —— 关键改动：先 await params，再解构 id
    const { id: jobId } = await params

    console.log(`DELETE /api/jobs/${jobId} - Deleting job`)

    const job = await Job.findById(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    await Job.findByIdAndDelete(jobId)
    await StatusHistory.deleteMany({ jobId })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(`DELETE /api/jobs/[id] - Error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
