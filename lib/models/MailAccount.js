// lib/models/MailAccount.js
import mongoose from 'mongoose';

const MailAccountSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['gmail', 'outlook'],
      required: true,
    },
    emailAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
    },
    expiresAt: {
      type: Date,
    },
    scope: {
      type: String,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    metadata: {
      historyId: String, // Gmail history cursor
      deltaToken: String, // Outlook delta token
    },
  },
  { timestamps: true }
);

const MailAccount =
  mongoose.models.MailAccount ||
  mongoose.model('MailAccount', MailAccountSchema);

export default MailAccount;
