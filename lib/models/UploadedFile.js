import mongoose from 'mongoose';

// Keep the existing File model/collection so previously uploaded files remain accessible.
const schema = new mongoose.Schema({
  name: String,
  type: String,
  size: String,
  sizeBytes: Number,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileData: { type: Buffer, select: false },
  uploadDate: { type: Date, default: Date.now },
});
export default mongoose.models.File || mongoose.model('File', schema);
