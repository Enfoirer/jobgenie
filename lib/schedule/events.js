// One projection for both calendar and todo. History.date is deliberately never
// used as a fallback: it records the status event, not an appointment.
export function isAssessment(entry) {
  return /^(online assessment|oa|笔试)$/i.test((entry.interviewStage || '').trim())
    || (!entry.interviewStage && entry.source?.eventType === 'oa');
}

function timestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function projectSchedule(entry, job) {
  if (entry.deletedAt || !job) return [];
  const assessment = isAssessment(entry);
  const appointment = timestamp(entry.scheduledTime);
  const deadline = timestamp(entry.deadline);
  const events = [];
  const add = (kind, time, label) => events.push({
    id: `${entry._id}:${kind}`, historyId: String(entry._id), jobId: String(job._id),
    company: job.company, position: job.position, location: job.location || '',
    applicationStatus: job.status, kind, time, label, history: entry,
  });
  if (appointment) add('appointment', appointment, assessment ? 'Assessment appointment' : 'Interview');
  if (deadline) add('deadline', deadline, assessment ? 'Assessment deadline' : 'Deadline');
  // Infer missing dates from the current fields, rather than the AI's original
  // needsScheduling flag, which may be stale after a manual edit or a cleared date.
  if (entry.status === 'interviewing') {
    if (assessment && !deadline) add('deadline', null, 'Assessment deadline');
    if (!assessment && !appointment) add('appointment', null, 'Interview');
  }
  return events;
}

export function scheduleBucket(event, now = Date.now()) {
  if (!event.time) return 'unscheduled';
  return new Date(event.time).getTime() < Number(now) ? 'overdue' : 'upcoming';
}

export function sortSchedule(events) {
  return [...events].sort((a, b) => (a.time ? Date.parse(a.time) : Infinity)
    - (b.time ? Date.parse(b.time) : Infinity) || a.id.localeCompare(b.id));
}

// Use the same browser time zone for calendar placement, labels and date inputs.
export function dayKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone && { timeZone }),
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function monthDays(year, month) {
  const first = new Date(year, month, 1, 12);
  return Array.from({ length: 42 }, (_, index) => new Date(year, month, 1 - first.getDay() + index, 12));
}
