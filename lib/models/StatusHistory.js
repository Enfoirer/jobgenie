// lib/models/StatusHistory.js
import mongoose from 'mongoose';

const StatusHistorySchema = new mongoose.Schema({
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  status: {
    type: String,
    required: true,
    enum: ['applied', 'interviewing', 'completed'],
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  notes: {
    type: String,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// This is important for Next.js to prevent duplicate model errors
const StatusHistory = mongoose.models.StatusHistory || mongoose.model('StatusHistory', StatusHistorySchema);

export default StatusHistory;