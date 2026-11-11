import PushDevice from '../models/PushDevice.js';
import PushDelivery from '../models/PushDelivery.js';
import PushWorker from '../models/PushWorker.js';

let pending;
export function ensurePushIndexes() {
  // Initialize new collections before any transaction and require the active-token
  // uniqueness constraint before accepting device bindings. Never drop indexes.
  pending ||= Promise.all([PushDevice, PushDelivery, PushWorker].map(model => model.init())).catch(error => {
    pending = undefined; throw error;
  });
  return pending;
}
