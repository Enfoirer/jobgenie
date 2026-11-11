import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String,
  deviceId: String,
  bindingId: String,
  userId: mongoose.Schema.Types.ObjectId,
  historyId: mongoose.Schema.Types.ObjectId,
  kind: String,
  revision: Number,
  phase: String,
  status: { type: String, enum: ['sending', 'sent', 'retry', 'rejected', 'unknown', 'cancelled'] },
  attempts: Number,
  retryAt: Date,
  expiresAt: Date,
  updatedAt: Date,
}, { versionKey: false });
schema.index({ userId: 1, deviceId: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });
export default mongoose.models.PushDelivery || mongoose.model('PushDelivery', schema);
