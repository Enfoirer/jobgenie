import Job from '../models/Job.js';

export function normalizeCompany(value = '') {
  return words(value).replace(/(?:\s+(?:incorporated|inc|corporation|corp|limited|ltd|llc|plc|gmbh))+$/g, '').replace(/(?:股份有限公司|有限公司)$/u, '').trim();
}
export function normalizePosition(value = '') {
  // Keep punctuation that changes a technology's meaning before tokenizing.
  const title = typeof value === 'string' ? value.normalize('NFKC').toLowerCase()
    .replace(/\bc\+\+/g, ' cpp ').replace(/\bc#/g, ' csharp ').replace(/\bf#/g, ' fsharp ')
    .replace(/\.net\b/g, ' dotnet ') : '';
  return words(title).replace(/\bswe\b/g, 'software engineer').split(' ').filter(Boolean).sort().join(' ');
}
function words(value) {
  return typeof value === 'string' ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim() : '';
}
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pairs = (text) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
  const x = pairs(a), y = pairs(b);
  return x.size + y.size ? 2 * [...x].filter((p) => y.has(p)).length / (x.size + y.size) : 0;
}
function candidate(job) {
  return { jobId: String(job._id), company: job.company, position: job.position, status: job.status };
}

export function matchApplication(jobs, { company, position }) {
  const companyKey = normalizeCompany(company), positionKey = normalizePosition(position);
  if (!companyKey || !positionKey) return { kind: 'incomplete', candidates: [], jobId: null };
  const exact = jobs.filter((job) => normalizeCompany(job.company) === companyKey && normalizePosition(job.position) === positionKey);
  if (exact.length === 1) return { kind: 'matched', jobId: String(exact[0]._id), candidates: exact.map(candidate) };
  if (exact.length > 1) return { kind: 'ambiguous', jobId: null, candidates: exact.map(candidate).slice(0, 10) };
  // Near matches are suggestions only: preserve seniority and distinct roles.
  const near = jobs.filter((job) => similarity(companyKey, normalizeCompany(job.company)) >= 0.85
    && similarity(positionKey, normalizePosition(job.position)) >= 0.85);
  return { kind: near.length ? 'uncertain' : 'new', jobId: null, candidates: near.map(candidate).slice(0, 10) };
}

export async function findApplicationMatch(userId, fields, session) {
  const query = Job.find({ userId }, { company: 1, position: 1, status: 1 });
  if (session) query.session(session);
  return matchApplication(await query.lean(), fields);
}
