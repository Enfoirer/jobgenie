import mongoose from 'mongoose';

const invitation = new mongoose.Schema({
  id: { type: String, required: true },
  requestId: { type: String, required: true },
  offeredAt: { type: Date, required: true },
  shownAt: Date,
  disposition: { type: String, enum: ['offered', 'shown', 'later', 'never', 'submitted'], default: 'offered' },
  respondedAt: Date,
  appVersion: String,
  locale: String,
  platform: { type: String, enum: ['ios', 'web'], default: 'ios' },
}, { _id: false });
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true }, // Signed-in user ID.
  campaign: { type: String, required: true },
  firstSeenAt: { type: Date, required: true },
  activeDays: { type: [String], default: [] }, // UTC dates, bounded to the last 30 days.
  disabledAt: Date, // Account-wide and retained when future campaigns are introduced.
  snoozedUntil: Date,
  submittedAt: Date,
  invitations: { type: [invitation], default: [] }, // At most two offers in this campaign.
  manualLaterCount: { type: Number, default: 0 },
  lastLaterRequestId: String,
}, { timestamps: true });
export default mongoose.models.FeedbackProfile || mongoose.model('FeedbackProfile', schema);
