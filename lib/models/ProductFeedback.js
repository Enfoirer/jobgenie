import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String, required: true }, // user:campaign, unique even across concurrent retries.
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  campaign: { type: String, required: true },
  overall: { type: Number, min: 1, max: 5, required: true },
  recommendation: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, maxlength: 2000, default: '' },
  source: { type: String, enum: ['prompt', 'manual'], required: true },
  invitationId: String,
  appVersion: String,
  locale: String,
  platform: { type: String, default: 'ios' },
  activeDayCount: Number,
  daysSinceFirstSeen: Number,
  createdAt: { type: Date, required: true },
});
schema.index({ campaign: 1, source: 1, createdAt: -1 });
export default mongoose.models.ProductFeedback || mongoose.model('ProductFeedback', schema);
