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
  },
  { timestamps: true }
);

ProcessedEmailSchema.index(
  { accountId: 1, messageId: 1 },
  { unique: true }
);

const ProcessedEmail =
  mongoose.models.ProcessedEmail ||
  mongoose.model('ProcessedEmail', ProcessedEmailSchema);

export default ProcessedEmail;
