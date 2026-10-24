import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String,
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  sessionHash: { type: String, required: true },
  provider: { type: String, enum: ['google', 'outlook'], required: true },
  challenge: { type: String, required: true },
  status: { type: String, enum: ['awaiting', 'ready', 'cancelled', 'failed'], required: true },
  code: { type: String, select: false },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.NativeOAuthAttempt || mongoose.model('NativeOAuthAttempt', schema);
