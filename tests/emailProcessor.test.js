import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { processEmailForPending } from '../lib/pipeline/emailProcessor.js';

let previousKey;
beforeEach(() => {
  previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
});
afterEach(() => {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
});
const mail = { subject: 'Application update', bodyText: 'Unfortunately we cannot proceed.' };

test('temporary extraction API failures throw so the inbox can retry', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429 }));
  await assert.rejects(processEmailForPending(mail), /extraction request failed \(429\)/);
});
test('malformed extraction output throws instead of silently finishing the email', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'not JSON' } }] }));
  await assert.rejects(processEmailForPending(mail), /invalid JSON/);
});
test('empty extraction output is retryable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [] }));
  await assert.rejects(processEmailForPending(mail), /no content/);
});
test('optional extraction remains optional without an API key', async (t) => {
  delete process.env.OPENAI_API_KEY;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call external service'); });
  const result = await processEmailForPending(mail);
  assert.equal(result.shouldCreate, true);
  assert.equal(result.parsed.eventType, 'rejection');
});
