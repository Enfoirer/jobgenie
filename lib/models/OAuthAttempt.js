import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String,
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  provider: { type: String, enum: ['google', 'outlook'], required: true },
  sessionHash: { type: String, required: true },
  stateHash: { type: String, required: true },
  browserHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.OAuthAttempt || mongoose.model('OAuthAttempt', schema);
