import { createHash } from 'node:crypto';
import AuthRateLimit from '../models/AuthRateLimit.js';

export async function consumeAuthLimit(key, maximum, windowMs, now = Date.now()) {
  const bucket = Math.floor(now / windowMs);
  const id = createHash('sha256').update(`${key}:${bucket}`).digest('hex');
  let row;
  try {
    row = await AuthRateLimit.findOneAndUpdate({ _id: id }, {
      $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) },
    }, { upsert: true, new: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    row = await AuthRateLimit.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true });
  }
  return row.count <= maximum;
}
