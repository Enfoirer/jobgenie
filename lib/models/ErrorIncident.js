import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String,
  dedupeKey: { type: String, unique: true, select: false },
  platform: { type: String, enum: ['server', 'web', 'ios'], required: true },
  kind: String,
  location: String,
  code: String,
  route: String,
  method: String,
  status: Number,
  version: String,
  release: String,
  environment: String,
  digest: String,
  count: { type: Number, default: 1 },
  createdAt: Date,
  lastSeenAt: Date,
  expiresAt: { type: Date, index: { expires: 0 } },
}, { versionKey: false, strict: 'throw' });
schema.index({ createdAt: -1, _id: -1 });
export default mongoose.models.ErrorIncident || mongoose.model('ErrorIncident', schema);
