const STRONG = {
  submission: [/application (?:received|submitted)/i, /thank you for applying/i, /we (?:have )?received your application/i, /申请已(?:收到|提交)|已收到.{0,12}申请/],
  oa: [/online assessment|coding challenge|take.home (?:assignment|assessment)|hackerrank|codility|笔试|在线测评/i],
  interview: [/(?:invite|invitation|inviting).{0,50}interview|interview.{0,40}(?:invite|invitation|scheduled|schedule)|phone screen|面试邀请|面试安排/i],
  rejection: [/unfortunately|regret to inform|not (?:be )?(?:moving|proceeding) forward|application.{0,25}(?:unsuccessful|rejected)|未能通过|很遗憾|不再推进/i],
  offer: [/(?:pleased|delighted).{0,40}(?:offer|extend)|offer of employment|job offer|employment offer|录用通知|录用意向/i],
};
const JOB_HINT = /application|apply|interview|assessment|candidate|recruit|offer|职位|申请|面试|笔试|录用/i;
const MARKETING = /job alerts?|job digest|recommended jobs|job recommendations?|newsletter|职位推荐|推荐岗位|招聘周报/i;

// Classification is independent from entity extraction; generic words like
// "schedule" or "congratulations" alone are not a reliable status update.
export function classifyEmail({ subject = '', bodyText = '', snippet = '' }) {
  const text = `${subject}\n${bodyText || snippet}`;
  const hits = Object.entries(STRONG).filter(([, patterns]) => patterns.some((p) => p.test(text))).map(([event]) => event);
  // Rejection/offer messages often mention a prior interview or application.
  const terminal = hits.filter((event) => ['rejection', 'offer'].includes(event));
  const relevantHits = terminal.length ? terminal : hits.filter((event) => event !== 'submission' || hits.length === 1);
  if (MARKETING.test(text) && !hits.length) return { isRelevant: false, eventType: 'other', confidence: 0.95, ambiguous: false };
  if (relevantHits.length === 1) return { isRelevant: true, eventType: relevantHits[0], confidence: 0.9, ambiguous: false };
  return {
    isRelevant: JOB_HINT.test(text) ? true : null, eventType: 'other',
    confidence: 0, ambiguous: relevantHits.length > 1,
  };
}
