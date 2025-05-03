// lib/dummyData.ts

export type Job = {
  id: string
  company: string
  title: string
  location: string
  status: 'Applied' | 'Interviewing' | 'Rejected'
  date: string
}

export const dummyJobs: Job[] = [
  { id: '1', company: 'Google', title: 'SWE Intern', location: 'CA', status: 'Applied', date: '2025-04-01' },
  { id: '2', company: 'Meta', title: 'ML Intern', location: 'NY', status: 'Interviewing', date: '2025-04-15' },
  { id: '3', company: 'TikTok', title: 'DE Intern', location: 'Singapore', status: 'Rejected', date: '2025-03-30' },
]
