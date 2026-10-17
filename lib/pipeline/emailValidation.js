export const EVENT_TYPES = ['submission', 'oa', 'interview', 'rejection', 'offer'];

export function cleanText(value, max = 200) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
}

export function cleanEntity(value) {
  const text = cleanText(value);
  return /^(?:unknown(?: company| position)?|n\/?a|none|null|not (?:specified|provided)|未知|未提供|待定)$/i.test(text) ? '' : text;
}

// Require a full timestamp with a timezone. Date.parse alone accepts rollover
// dates (February 30) and local-time strings that change meaning across servers.
export function parseEmailDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59
    || (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function validateExtraction(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push('invalid_payload'); raw = {}; }
  const text = (field, max = 200) => {
    if (raw[field] !== undefined && raw[field] !== null && typeof raw[field] !== 'string') errors.push(`invalid_${field}`);
    return cleanText(raw[field], max);
  };
  const date = (field) => {
    const parsed = parseEmailDate(raw[field]);
    if (raw[field] !== undefined && raw[field] !== null && raw[field] !== '' && !parsed) errors.push(`invalid_${field}`);
    return parsed;
  };
  const eventType = EVENT_TYPES.includes(raw.eventType) ? raw.eventType : 'other';
  if (eventType === 'other' && !(raw.isStatusUpdate === false && raw.eventType === 'other')) errors.push('invalid_eventType');
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : 0;
  if (confidence !== raw.confidence) errors.push('invalid_confidence');
  for (const field of ['isStatusUpdate', 'needsScheduling']) {
    if (typeof raw[field] !== 'boolean') errors.push(`invalid_${field}`);
  }
  return {
    eventType, confidence, company: cleanEntity(text('company')), position: cleanEntity(text('position')),
    interviewTime: date('scheduledTime'), deadline: date('deadline'),
    needsScheduling: raw.needsScheduling === true,
    isStatusUpdate: typeof raw.isStatusUpdate === 'boolean' ? raw.isStatusUpdate : null,
    summary: text('summary', 1000), rationale: text('rationale', 1000), validationErrors: errors,
  };
}
