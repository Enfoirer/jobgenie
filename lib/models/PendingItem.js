// lib/models/PendingItem.js
import mongoose from 'mongoose';

const PendingItemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'MailAccount', required: true, index: true },
    provider: { type: String, enum: ['gmail', 'outlook'], required: true },
    messageId: { type: String, required: true },
    threadId: String,
    subject: String,
    from: String,
    to: String,
    snippet: String,
    receivedAt: Date,
    raw: mongoose.Schema.Types.Mixed,
    // Parsed fields
    company: String,
    position: String,
    eventType: {
      type: String,
      enum: ['submission', 'oa', 'interview', 'rejection', 'offer', 'other'],
      default: 'other',
    },
    isRelevant: { type: Boolean, default: true },
    interviewTime: Date,
    confidence: { type: Number, default: 0 },
    summary: String,
  rationale: String,
  deadline: Date,
  needsScheduling: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'accepted', 'ignored'], default: 'pending', index: true },
    recommendedAction: { type: String },
    notes: String,
  },
  { timestamps: true }
);

PendingItemSchema.index({ userId: 1, messageId: 1, provider: 1 }, { unique: true });

const PendingItem =
  mongoose.models.PendingItem || mongoose.model('PendingItem', PendingItemSchema);

export default PendingItem;
