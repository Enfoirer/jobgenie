import { createPrivateKey, createPublicKey, createHash, sign, randomUUID } from 'node:crypto';
import { connect } from 'node:http2';

export function apnsConfig(env = process.env) {
  if (env.PUSH_ENABLED !== 'true') return null;
  if (!/^[A-Z0-9]{10}$/.test(env.APNS_TEAM_ID || '') || !/^[A-Z0-9]{10}$/.test(env.APNS_KEY_ID || '')
    || !/^[A-Za-z0-9.-]{3,200}$/.test(env.APNS_TOPIC || '')) return null;
  try {
    const key = createPrivateKey((env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    return { key, teamId: env.APNS_TEAM_ID, keyId: env.APNS_KEY_ID, topic: env.APNS_TOPIC,
      environments: env.APNS_ALLOW_SANDBOX === 'true' ? ['production', 'sandbox'] : ['production'] };
  } catch { return null; }
}
let cached;
export function providerToken(config, now = Date.now()) {
  const fingerprint = createHash('sha256').update(createPublicKey(config.key).export({ type: 'spki', format: 'der' })).digest('hex');
  const key = `${config.teamId}:${config.keyId}:${fingerprint}`;
  if (cached?.key === key && now >= cached.at && now - cached.at < 50 * 60000) return cached.token;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode({ alg: 'ES256', kid: config.keyId })}.${encode({ iss: config.teamId, iat: Math.floor(now / 1000) })}`;
  const token = `${data}.${sign('sha256', Buffer.from(data), { key: config.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  cached = { key, at: now, token };
  return token;
}
export function notificationPayload(device, delivery, reminder) {
  const zh = device.locale === 'zh-Hans';
  return { aps: { alert: { title: 'JobGenie', body: zh ? '你有即将到来的日程，请打开 App 查看最新安排。' : 'You have an upcoming event. Open JobGenie for the latest schedule.' }, sound: 'default' },
    jg: { deliveryId: delivery._id, bindingId: device.bindingId, reminderId: reminder.id } };
}
// An ambiguous transport result is never retried: APNs may already have accepted
// the alert. Only an explicit temporary rejection is safe to retry.
export function sendAPNs(config, device, delivery, reminder, { transport = connect } = {}) {
  return new Promise(resolve => {
    let client, request, finished = false, timer;
    const finish = value => {
      if (finished) return; finished = true; clearTimeout(timer);
      request?.close(); client?.destroy(); resolve(value);
    };
    timer = setTimeout(() => finish({ status: 'unknown' }), 8000);
    try {
      client = transport(device.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
      client.on('error', () => finish({ status: 'unknown' }));
      request = client.request({ ':method': 'POST', ':path': `/3/device/${device.token}`,
        authorization: `bearer ${providerToken(config)}`, 'apns-topic': config.topic,
        'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': '0',
        'apns-id': randomUUID(), 'apns-collapse-id': createHash('sha256')
          .update(`${device._id}:${device.userId}:${reminder.historyId}:${reminder.kind}`).digest('hex') });
      let status = 0, body = '';
      request.on('response', headers => { status = Number(headers[':status']); });
      request.on('data', chunk => { if (body.length < 1024) body += chunk; });
      request.on('error', () => finish({ status: 'unknown' }));
      request.on('end', () => {
        let reason; try { reason = JSON.parse(body).reason; } catch { /* No response body on success. */ }
        finish({ status: status === 200 ? 'sent' : [429, 500, 503].includes(status) ? 'retry' : 'rejected',
          invalidateDevice: status === 410 || ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(reason) });
      });
      request.end(JSON.stringify(notificationPayload(device, delivery, reminder)));
    } catch { finish({ status: 'unknown' }); }
  });
}
