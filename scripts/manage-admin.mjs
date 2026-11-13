import mongoose from 'mongoose';
import User from '../lib/models/User.js';
const [action, rawEmail] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !rawEmail || !process.env.MONGODB_URI) {
  console.error('Usage: npm run admin:manage -- grant|revoke account@example.com (requires MONGODB_URI)');
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const result = await User.updateOne({ email: rawEmail.trim().toLowerCase() }, { $set: { role: action === 'grant' ? 'admin' : 'user' } });
    if (!result.matchedCount) throw new Error('Account not found');
    console.log('Administrator role updated.');
  } catch { console.error('Unable to update administrator role. Check the account and database configuration.'); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}
