// app/dashboard/jobs/page.tsx

'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { dummyJobs } from '@/lib/dummyData'

export default function JobsPage() {
  const [jobs, setJobs] = useState(dummyJobs)
  const statuses = ['Applied', 'Interviewing', 'Rejected'] as const

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Job Board</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statuses.map((status) => (
          <div key={status}>
            <h2 className="text-lg font-semibold mb-2">{status}</h2>
            <div className="space-y-4">
              {jobs
                .filter((job) => job.status === status)
                .map((job) => (
                  <Card key={job.id}>
                    <CardContent className="p-4">
                      <div className="font-semibold">{job.company}</div>
                      <div className="text-sm text-muted-foreground">{job.title}</div>
                      <div className="text-sm">{job.location}</div>
                      <div className="text-sm">{job.date}</div>
                      <div className="mt-2 flex justify-between items-center">
                        <Badge variant="secondary">{job.status}</Badge>
                        <Button variant="outline" size="sm">Edit</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
