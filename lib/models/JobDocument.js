import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  sourceFileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['resume', 'coverLetter', 'portfolio'], required: true },
  version: { type: Number, required: true },
  label: { type: String, default: '' },
  name: String, type: String, size: String, sizeBytes: Number,
  fileData: { type: Buffer, select: false },
  createdAt: { type: Date, default: Date.now },
});
schema.index({ jobId: 1, kind: 1, version: 1 }, { unique: true });
export default mongoose.models.JobDocument || mongoose.model('JobDocument', schema);
