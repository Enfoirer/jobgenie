import mongoose from 'mongoose';
import Job from '../models/Job.js';
import StatusHistory from '../models/StatusHistory.js';
import { projectSchedule, sortSchedule } from './events.js';

export async function listSchedule(userId) {
  if (!mongoose.isValidObjectId(userId)) throw Object.assign(new Error('Invalid user ID'), { status: 400 });
  // Join only existing applications owned by this same user. One query avoids
  // per-application requests and never filters out a job that progressed to Offer.
  const rows = await StatusHistory.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)), deletedAt: null,
      $or: [{ status: 'interviewing' }, { scheduledTime: { $type: 'date' } }, { deadline: { $type: 'date' } }] } },
    { $lookup: { from: Job.collection.name, let: { job: '$jobId', owner: '$userId' }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$_id', '$$job'] }, { $eq: ['$userId', '$$owner'] }] } } },
      { $project: { company: 1, position: 1, location: 1, status: 1 } },
    ], as: 'application' } },
    { $unwind: '$application' },
    { $project: { application: 1, status: 1, interviewStage: 1, date: 1, notes: 1,
      scheduledTime: 1, deadline: 1, statusApplied: 1, source: 1 } },
  ]);
  return sortSchedule(rows.flatMap(({ application, ...entry }) => projectSchedule(entry, application)));
}
