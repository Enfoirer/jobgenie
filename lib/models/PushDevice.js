import mongoose from 'mongoose';

// _id is a one-way hash of an installation capability kept in the iOS Keychain.
// Sequence numbers survive logout and stop delayed registrations from rebinding
// a device after a newer logout/account switch.
const schema = new mongoose.Schema({
  _id: String,
  sequence: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  sessionId: String,
  authVersion: Number,
  expiresAt: Date,
  bindingId: String,
  token: { type: String, select: false },
  tokenHash: String,
  environment: { type: String, enum: ['sandbox', 'production'] },
  locale: { type: String, enum: ['en', 'zh-Hans'] },
  active: { type: Boolean, default: false },
  updatedAt: Date,
}, { versionKey: false });
schema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { active: true } });
schema.index({ active: 1, expiresAt: 1, _id: 1 });
export default mongoose.models.PushDevice || mongoose.model('PushDevice', schema);
