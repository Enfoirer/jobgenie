export function rangeError(message) { throw Object.assign(new Error(message), { status: 400 }); }
const DAY = 86400000;
export function dateInZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (key) => parts.find((item) => item.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1970-01-01' && value <= '9998-12-31'
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function addDays(value, count) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}
// Calendar boundaries, including 23/25-hour days and midnight DST gaps.
export function startOfDay(value, timeZone) {
  const utc = Date.parse(`${value}T00:00:00Z`);
  let low = utc - 36 * 3600000, high = utc + 36 * 3600000;
  const format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const key = (instant) => {
    const parts = format.formatToParts(new Date(instant));
    return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
  };
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (key(mid) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function parseStatsRange(params, now = Date.now()) {
  for (const key of params.keys()) {
    if (!['days', 'start', 'end', 'timeZone'].includes(key) || params.getAll(key).length !== 1) rangeError('Unsupported or repeated range parameter');
  }
  const timeZone = params.get('timeZone') ?? 'UTC';
  if (!timeZone || timeZone.length > 100) rangeError('Choose a valid IANA time zone');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); }
  catch { rangeError('Choose a valid IANA time zone'); }
  const today = dateInZone(now, timeZone);
  let start, end, days;
  if (params.has('start') || params.has('end')) {
    if (params.has('days')) rangeError('Use days or start/end, not both');
    start = params.get('start'); end = params.get('end');
    if (!validDate(start) || !validDate(end) || start > end) rangeError('Choose valid start and end dates in order');
    days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY + 1;
  } else {
    const raw = params.get('days') ?? '30';
    if (!/^\d+$/.test(raw)) rangeError('Days must be an integer from 1 to 366');
    days = Number(raw);
    if (days < 1 || days > 366) rangeError('Days must be an integer from 1 to 366');
    end = today; start = addDays(end, 1 - days);
  }
  if (days > 366) rangeError('Choose at most 366 calendar days');
  if (end > today) rangeError('End date cannot be in the future in the selected time zone');
  const startMs = startOfDay(start, timeZone), endMs = startOfDay(addDays(end, 1), timeZone);
  return { start, end, days, timeZone, startMs, endMs, cutoffMs: Math.min(endMs, now + 1), now };
}
