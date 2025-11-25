// lib/pipeline/jobUpdater.js
import Job from '@/lib/models/Job';
import StatusHistory from '@/lib/models/StatusHistory';
import { COLUMNS } from '@/lib/mockData';

const statusMap = {
  submission: COLUMNS.APPLIED,
  oa: COLUMNS.INTERVIEWING,
  interview: COLUMNS.INTERVIEWING,
  rejection: COLUMNS.REJECTED,
  offer: COLUMNS.OFFER,
  other: COLUMNS.APPLIED,
};

export async function applyEventToJob({
  userId,
  company,
  position,
  eventType,
  subject,
  snippet,
  receivedAt,
}) {
  const targetStatus = statusMap[eventType] || COLUMNS.APPLIED;

  let job = null;
  if (company || position) {
    job = await Job.findOne({
      userId,
      ...(company ? { company } : {}),
      ...(position ? { position } : {}),
    });
  }

  if (!job) {
    job = await Job.create({
      userId,
      company: company || 'Unknown Company',
      position: position || 'Unknown Position',
      status: targetStatus,
      notes: subject || '',
      dateApplied: receivedAt || new Date(),
      applicationSource: 'Email',
    });
  } else {
    job.status = targetStatus;
    job.notes = subject || job.notes;
    await job.save();
  }

  await StatusHistory.create({
    jobId: job._id,
    status: targetStatus,
    date: receivedAt || new Date(),
    notes: snippet || '',
    userId,
  });

  return job;
}
