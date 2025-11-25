// lib/classify/emailClassifier.js
// Simple rule-based classifier placeholder; replace with LLM later.

const KEYWORDS = {
  submission: ['application received', 'thank you for applying', 'we received your application'],
  oa: ['online assessment', 'take-home', 'coding challenge', 'hackerrank', 'codility'],
  interview: ['interview', 'schedule', 'invite', 'onsite', 'phone screen', 'meeting'],
  rejection: ['unfortunately', 'regret to inform', 'not moving forward', 'reject'],
  offer: ['offer', 'congratulations', 'we are pleased to', 'extend'],
};

export function classifyEmail({ subject = '', snippet = '', from = '' }) {
  const text = `${subject} ${snippet}`.toLowerCase();
  const scores = {};

  Object.entries(KEYWORDS).forEach(([type, words]) => {
    scores[type] = words.reduce(
      (score, w) => (text.includes(w) ? score + 1 : score),
      0
    );
  });

  // Pick best
  let best = 'other';
  let bestScore = 0;
  Object.entries(scores).forEach(([type, score]) => {
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  });

  const confidence = Math.min(1, bestScore / 3);

  return {
    eventType: best,
    confidence,
    recommendedAction: best === 'interview' || best === 'offer' ? 'review' : 'auto',
  };
}
