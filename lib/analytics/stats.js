import mongoose from 'mongoose';
import Job from '../models/Job.js';
import StatusHistory from '../models/StatusHistory.js';
import { addDays, dateInZone } from './range.js';

export const STATUSES = ['applied', 'interviewing', 'offer', 'rejected'];
const emptyCounts = () => Object.fromEntries(STATUSES.map((status) => [status, 0]));
const rate = (numerator, denominator) => ({ numerator, denominator, percent: denominator ? numerator / denominator * 100 : null });

export function computeStats(jobs, histories, range) {
  const currentCounts = emptyCounts();
  const byId = new Map(jobs.map((job) => [String(job._id), job]));
  const rows = new Map();
  const timeline = {};
  for (let index = 0; index < range.days; index++) timeline[addDays(range.start, index)] = { applications: 0, ...emptyCounts() };
  for (const job of jobs) {
    if (STATUSES.includes(job.status)) currentCounts[job.status]++;
    const applied = job.dateApplied ? new Date(job.dateApplied).getTime() : NaN;
    if (applied >= range.startMs && applied < range.cutoffMs) {
      const day = dateInZone(applied, range.timeZone);
      if (timeline[day]) timeline[day].applications++;
      rows.set(String(job._id), { id: String(job._id), company: job.company, position: job.position,
        appliedAt: new Date(applied).toISOString(), interviewAt: null, offerAt: null, rejectedAt: null,
        interviewToOffer: false, recordedEvents: 0, offerTimes: [] });
    }
  }
  for (const entry of histories) {
    const job = byId.get(String(entry.jobId)), time = entry.date ? new Date(entry.date).getTime() : NaN;
    if (!job || entry.deletedAt || !STATUSES.includes(entry.status) || time < range.startMs || time >= range.cutoffMs || !Number.isFinite(time)) continue;
    const day = dateInZone(time, range.timeZone);
    if (timeline[day]) timeline[day][entry.status]++;
    const row = rows.get(String(entry.jobId));
    // Pre-application events do not establish this application's progression.
    if (!row || time < Date.parse(row.appliedAt)) continue;
    row.recordedEvents++;
    const field = { interviewing: 'interviewAt', offer: 'offerAt', rejected: 'rejectedAt' }[entry.status];
    if (field && (!row[field] || time < Date.parse(row[field]))) row[field] = new Date(time).toISOString();
    if (entry.status === 'offer') row.offerTimes.push(time);
  }
  const applications = [...rows.values()].map(({ offerTimes, ...row }) => ({ ...row,
    interviewToOffer: !!row.interviewAt && offerTimes.some((time) => time >= Date.parse(row.interviewAt)),
  })).sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.id.localeCompare(b.id));
  const reached = { applied: applications.length, interviewing: 0, offer: 0, rejected: 0 };
  let converted = 0, offersWithoutPriorInterview = 0, withoutHistory = 0;
  for (const row of applications) {
    if (row.interviewAt) reached.interviewing++;
    if (row.offerAt) reached.offer++;
    if (row.rejectedAt) reached.rejected++;
    if (row.interviewToOffer) converted++;
    if (row.offerAt && !row.interviewToOffer) offersWithoutPriorInterview++;
    if (!row.recordedEvents) withoutHistory++;
  }
  return {
    range: { start: range.start, end: range.end, days: range.days, timeZone: range.timeZone,
      startInclusive: new Date(range.startMs).toISOString(), endExclusive: new Date(range.endMs).toISOString(),
      observedThrough: new Date(Math.min(range.endMs - 1, range.now)).toISOString() },
    currentStatus: { total: jobs.length, counts: currentCounts, asOf: new Date(range.now).toISOString() },
    cohort: { total: applications.length, reached, offersWithoutPriorInterview, withoutHistory,
      conversion: { appliedToInterview: rate(reached.interviewing, applications.length),
        interviewToOffer: rate(converted, reached.interviewing), appliedToOffer: rate(reached.offer, applications.length) },
      applications },
    timeline,
  };
}

export async function loadStats(userId, range) {
  if (!mongoose.isValidObjectId(userId)) throw Object.assign(new Error('Invalid user ID'), { status: 400 });
  // Snapshot reads prevent concurrent edits splitting counts from their histories.
  return mongoose.connection.transaction(async (session) => {
    const jobs = await Job.find({ userId }).select('company position status dateApplied').session(session).lean();
    const histories = await StatusHistory.find({ userId, jobId: { $in: jobs.map((job) => job._id) }, deletedAt: null,
      date: { $gte: new Date(range.startMs), $lt: new Date(range.cutoffMs) },
    }).select('jobId status date deletedAt').session(session).lean();
    return computeStats(jobs, histories, range);
  }, { readConcern: { level: 'snapshot' } });
}
