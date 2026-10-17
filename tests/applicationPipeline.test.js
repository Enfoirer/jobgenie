import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { processEmailForPending } from '../lib/pipeline/emailProcessor.js';
import { parseEmailDate, validateExtraction } from '../lib/pipeline/emailValidation.js';
import { matchApplication } from '../lib/pipeline/jobMatcher.js';
import { decideSyncAction } from '../lib/pipeline/syncPolicy.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/application-emails.json', import.meta.url)));
const valid = fixtures[0].extraction;
for (const fixture of fixtures) {
  test(`fixed acceptance email: ${fixture.name}`, async () => {
    let calls = 0;
    const result = await processEmailForPending(fixture.message, { extractor: async () => { calls++; return fixture.extraction; } });
    assert.equal(result.shouldCreate, fixture.expectedCreate);
    if (!fixture.expectedCreate) { assert.equal(calls, 0); return; }
    assert.equal(calls, 1);
    assert.equal(result.parsed.eventType, fixture.expectedEvent);
    assert.equal(result.parsed.requiresReview, fixture.expectedReview);
    if (fixture.name !== 'incomplete') {
      assert.equal(result.parsed.company, 'Acme Inc.');
      assert.equal(result.parsed.position, 'Software Engineer, Backend');
    }
    if (fixture.name === 'interview') assert.equal(result.parsed.interviewTime.toISOString(), '2026-10-21T13:00:00.000Z');
    if (fixture.name === 'assessment') assert.equal(result.parsed.deadline.toISOString(), '2026-10-21T03:59:00.000Z');
  });
}

test('a strong classification still extracts fields, and does not boost low extraction confidence', async () => {
  const result = await processEmailForPending({ subject: 'Application received', bodyText: 'Thank you for applying. We received your application.' }, {
    extractor: async () => ({ ...valid, confidence: 0.15 }),
  });
  assert.equal(result.parsed.company, 'Acme Inc.');
  assert.equal(result.parsed.confidence, 0.15);
  assert.equal(decideSyncAction(result.parsed, { kind: 'new' }, { syncMode: 'auto' }).action, 'review');
});

test('invalid confidence, types and booleans are quarantined for review', () => {
  for (const confidence of [-1, 1.1, NaN, Infinity, '0.95', null]) {
    const fields = validateExtraction({ ...valid, confidence });
    assert.equal(fields.confidence, 0);
    assert.ok(fields.validationErrors.includes('invalid_confidence'));
  }
  const fields = validateExtraction({ ...valid, company: { bad: true }, position: ['Engineer'], eventType: 'hired', isStatusUpdate: 'false', needsScheduling: 'true' });
  assert.equal(fields.company, '');
  assert.equal(fields.eventType, 'other');
  assert.equal(fields.isStatusUpdate, null);
  assert.equal(fields.needsScheduling, false);
  assert.equal(fields.validationErrors.length, 5);
});

test('calendar dates and timezones are validated before database writes', () => {
  for (const date of ['2026-02-30T10:00:00Z', '2026-02-29T10:00:00Z', '2026-10-20T25:00:00Z', '2026-10-20T09:00', 'next Tuesday', '2026-10-20', '2026-10-20T09:00:00+15:00', '2026-10-20T09:00:00+14:30', 1792198800000]) {
    assert.equal(parseEmailDate(date), null, String(date));
    assert.ok(validateExtraction({ ...valid, scheduledTime: date }).validationErrors.includes('invalid_scheduledTime'));
  }
  assert.equal(parseEmailDate('2028-02-29T10:00:00+08:00').toISOString(), '2028-02-29T02:00:00.000Z');
  assert.equal(parseEmailDate('2026-10-20T09:00:00-04:00').toISOString(), '2026-10-20T13:00:00.000Z');
});

test('AI/classifier disagreement requires review rather than silently choosing automation', async () => {
  const result = await processEmailForPending(fixtures[0].message, { extractor: async () => ({ ...valid, eventType: 'rejection' }) });
  assert.equal(result.parsed.requiresReview, true);
  assert.ok(result.parsed.reviewReasons.includes('event_type_conflict'));
});

test('rule-only mode extracts explicit labels and keeps incomplete updates reviewable', async () => {
  const result = await processEmailForPending({ subject: 'Application received', bodyText: 'Company: Acme\nPosition: Engineer\nThank you for applying.' }, { extractor: async () => undefined });
  assert.equal(result.parsed.company, 'Acme');
  assert.equal(result.parsed.position, 'Engineer');
  assert.equal(result.parsed.requiresReview, false);
  const missing = await processEmailForPending(fixtures[6].message, { extractor: async () => undefined });
  assert.equal(missing.shouldCreate, true);
  assert.equal(missing.parsed.requiresReview, true);
});

test('no-reply senders and unsubscribe footers do not discard application updates', async () => {
  const result = await processEmailForPending({ ...fixtures[0].message, from: 'no-reply@careers.example.test', bodyText: fixtures[0].message.bodyText + '\nUnsubscribe' }, { extractor: async () => valid });
  assert.equal(result.shouldCreate, true);
  assert.equal(result.parsed.requiresReview, false);
});

test('null or primitive extraction payloads cannot fall back to automatic rule-only updates', async () => {
  for (const raw of [null, false, [], 'false', {}]) {
    const result = await processEmailForPending(fixtures[0].message, { extractor: async () => raw });
    assert.equal(result.parsed.requiresReview, true);
    assert.equal(result.parsed.confidence, 0);
  }
});

test('matching normalizes case, punctuation, legal suffixes, abbreviations and role token order', () => {
  const jobs = [{ _id: 'one', company: 'ACME, Inc.', position: 'Backend SWE', status: 'applied' }];
  assert.equal(matchApplication(jobs, { company: 'Acme LLC', position: 'Software Engineer — Backend' }).jobId, 'one');
  assert.equal(matchApplication(jobs, { company: 'Acme', position: '' }).kind, 'incomplete');
  assert.notEqual(matchApplication(jobs, { company: 'Acme', position: 'Senior Backend SWE' }).kind, 'matched');
});

test('multiple matches and similar names require a human choice', () => {
  const first = { _id: 'one', company: 'Acme', position: 'Software Engineer' };
  assert.equal(matchApplication([first, { ...first, _id: 'two' }], first).kind, 'ambiguous');
  const uncertain = matchApplication([first], { company: 'Acme', position: 'Software Enginer' });
  assert.equal(uncertain.kind, 'uncertain');
  assert.equal(uncertain.jobId, null);
});

test('Auto, Semi and Strict follow the selected policy', () => {
  const parsed = { ...valid, reviewReasons: [], requiresReview: false };
  for (const eventType of ['submission', 'oa', 'interview', 'offer', 'rejection']) {
    const fields = { ...parsed, eventType };
    assert.equal(decideSyncAction(fields, { kind: 'matched' }, { syncMode: 'auto' }).action, 'apply');
    assert.equal(decideSyncAction(fields, { kind: 'matched' }, { syncMode: 'strict' }).action, 'review');
    assert.equal(decideSyncAction(fields, { kind: 'matched' }, { syncMode: 'semi' }).action, ['offer', 'rejection'].includes(eventType) ? 'review' : 'apply');
    assert.equal(decideSyncAction(fields, { kind: 'new' }, { syncMode: 'semi' }).action, 'review');
  }
  for (const kind of ['ambiguous', 'incomplete', 'uncertain']) assert.equal(decideSyncAction(parsed, { kind }, { syncMode: 'auto' }).action, 'review');
});

test('technology punctuation does not merge distinct application roles', () => {
  const job = { _id: 'cpp-role', company: 'Acme', position: 'C++ Developer' };
  assert.equal(matchApplication([job], { company: 'Acme', position: 'C# Developer' }).jobId, null);
  assert.equal(matchApplication([job], { company: 'Acme', position: 'C Developer' }).jobId, null);
  assert.equal(matchApplication([job], { company: 'Acme', position: 'C++ Developer' }).kind, 'matched');
});

test('invented company or position fields cannot trigger automatic application changes', async () => {
  const result = await processEmailForPending(fixtures[0].message, { extractor: async () => ({ ...valid, company: 'Imaginary Industries', position: 'Chief Architect' }) });
  assert.equal(result.parsed.requiresReview, true);
  assert.ok(result.parsed.reviewReasons.includes('unverified_company'));
  assert.ok(result.parsed.reviewReasons.includes('unverified_position'));
});

test('placeholder entity names are missing information, not new applications', async () => {
  const result = await processEmailForPending(fixtures[0].message, { extractor: async () => ({ ...valid, company: 'Unknown Company', position: 'N/A' }) });
  assert.equal(result.parsed.company, '');
  assert.equal(result.parsed.position, '');
  assert.equal(result.parsed.requiresReview, true);
});

test('Chinese status updates and explicit labels work in rule-only mode', async () => {
  const result = await processEmailForPending({ subject: '申请已提交', bodyText: '公司：星河有限公司\n职位：后端工程师\n已收到您的申请。' }, { extractor: async () => undefined });
  assert.equal(result.parsed.eventType, 'submission');
  assert.equal(result.parsed.company, '星河有限公司');
  assert.equal(result.parsed.position, '后端工程师');
  assert.equal(result.parsed.requiresReview, false);
});
