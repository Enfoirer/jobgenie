import mongoose from 'mongoose';
import ProcessedEmail from '../lib/models/ProcessedEmail.js';
import PendingItem from '../lib/models/PendingItem.js';
import StatusHistory from '../lib/models/StatusHistory.js';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before running this migration');
try {
  await mongoose.connect(process.env.MONGODB_URI);
  // Build replacement indexes before removing the old cross-account constraint.
  // Do not use syncIndexes(): unrelated indexes must remain untouched.
  for (const model of [ProcessedEmail, PendingItem, StatusHistory]) await model.createIndexes();
  for (const index of await PendingItem.collection.indexes()) {
    if (index.unique && JSON.stringify(index.key) === JSON.stringify({ userId: 1, messageId: 1, provider: 1 })) {
      await PendingItem.collection.dropIndex(index.name);
    }
  }
  console.log('Mail queue indexes are ready; existing records were preserved.');
} finally {
  await mongoose.disconnect();
}
