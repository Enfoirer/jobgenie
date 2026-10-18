import mongoose from 'mongoose';
import MailAccount from '../models/MailAccount.js';
import ProcessedEmail from '../models/ProcessedEmail.js';
import PendingItem from '../models/PendingItem.js';

export async function getMailSyncStatus(userId) {
  const owner = new mongoose.Types.ObjectId(String(userId));
  const accounts = await MailAccount.find({ userId: owner }, {
    provider: 1, emailAddress: 1, lastSync: 1, 'metadata.lastFetchedAt': 1,
    'metadata.gmailSync': 1, 'metadata.outlookSync': 1,
  }).sort({ createdAt: -1 }).lean();
  return Promise.all(accounts.map(async (account) => {
    const filter = { userId: owner, accountId: account._id };
    const [groups, failures, pendingReview] = await Promise.all([
      ProcessedEmail.aggregate([
        { $match: { ...filter, status: { $in: ['pending', 'processing', 'failed'] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      ProcessedEmail.find({ ...filter, status: 'failed' }, { 'raw.subject': 1, attempts: 1, updatedAt: 1 })
        .sort({ updatedAt: -1, _id: -1 }).limit(10).lean(),
      PendingItem.countDocuments({ ...filter, status: 'pending' }),
    ]);
    const backlog = { pending: 0, processing: 0, failed: 0, pendingReview };
    for (const group of groups) backlog[group._id] = group.count;
    return {
      id: String(account._id), provider: account.provider, emailAddress: account.emailAddress,
      lastFetchedAt: account.metadata?.lastFetchedAt || null,
      hasMore: !!(account.metadata?.gmailSync || account.metadata?.outlookSync),
      lastSync: account.lastSync || null, backlog,
      failures: failures.map((mail) => ({ id: String(mail._id), subject: mail.raw?.subject || '(No subject)', attempts: mail.attempts, updatedAt: mail.updatedAt })),
    };
  }));
}
