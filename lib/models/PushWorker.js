import mongoose from 'mongoose';
const schema = new mongoose.Schema({ _id: String, cursor: String, owner: String, leaseUntil: Date }, { versionKey: false });
export default mongoose.models.PushWorker || mongoose.model('PushWorker', schema);
