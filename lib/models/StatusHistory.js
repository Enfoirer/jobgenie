// lib/models/StatusHistory.js
import mongoose from 'mongoose';

const StatusHistorySchema = new mongoose.Schema({
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  // Stable identity for an email event; manual status changes have no key.
  sourceEmailKey: String,
  status: {
    type: String,
    required: true,
    enum: ['applied', 'interviewing', 'offer', 'rejected'],
  },
  // Added interviewStage field
  interviewStage: {
    type: String,
    required: false
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

StatusHistorySchema.index(
  { sourceEmailKey: 1 },
  { unique: true, partialFilterExpression: { sourceEmailKey: { $type: 'string' } } }
);

// This is important for Next.js to prevent duplicate model errors
const StatusHistory = mongoose.models.StatusHistory || mongoose.model('StatusHistory', StatusHistorySchema);

export default StatusHistory;
