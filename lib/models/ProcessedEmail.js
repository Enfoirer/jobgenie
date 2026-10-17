// lib/models/ProcessedEmail.js
import mongoose from 'mongoose';

const ProcessedEmailSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['gmail', 'outlook'],
      required: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MailAccount',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
    },
    threadId: String,
    receivedAt: Date,
    // Missing status identifies pre-queue legacy records. Do not replay them:
    // the old pipeline did not record whether business writes succeeded.
    status: {
      type: String,
      enum: ['pending', 'processing', 'succeeded', 'failed'],
    },
    raw: mongoose.Schema.Types.Mixed,
    attempts: { type: Number, default: 0 },
    leaseToken: String,
    leaseUntil: Date,
    lastError: String,
    processedAt: Date,
    outcome: { type: String, enum: ['skipped', 'pending_review', 'applied'] },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  },
  { timestamps: true }
);

ProcessedEmailSchema.index({ accountId: 1, status: 1, leaseUntil: 1 });

ProcessedEmailSchema.index(
  { accountId: 1, messageId: 1 },
  { unique: true }
);

const ProcessedEmail =
  mongoose.models.ProcessedEmail ||
  mongoose.model('ProcessedEmail', ProcessedEmailSchema);

export default ProcessedEmail;
