// lib/models/Job.js
import mongoose from 'mongoose';

const JobSchema = new mongoose.Schema({
  company: {
    type: String,
    required: [true, 'Please provide a company name'],
    trim: true,
  },
  position: {
    type: String,
    required: [true, 'Please provide a position title'],
    trim: true,
  },
  location: {
    type: String,
    trim: true,
  },
  applicationSource: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    required: [true, 'Please provide a status'],
    enum: ['applied', 'interviewing', 'offer', 'rejected'], // Updated to match StatusHistory
    default: 'applied',
  },
  dateApplied: {
    type: Date,
    default: Date.now,
  },
  notes: {
    type: String,
    trim: true,
  },
  // Add job URL field
  jobUrl: {
    type: String,
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'A job must belong to a user'],
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // This is a virtual field - it won't be stored in the database
  // but will be populated when needed
  statusHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StatusHistory'
  }]
});

// This is important for Next.js to prevent duplicate model errors
const Job = mongoose.models.Job || mongoose.model('Job', JobSchema);

export default Job;