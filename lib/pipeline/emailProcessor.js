// lib/pipeline/emailProcessor.js
// Combines rule-based relevance/type detection with optional LLM extraction.

import { classifyEmail } from '@/lib/classify/emailClassifier';

const JOB_KEYWORDS = [
  'application',
  'apply',
  'interview',
  'offer',
  'rejection',
  'assessment',
  'take-home',
  'challenge',
  'submission',
  'position',
  'role',
  'candidate',
];

const SPAM_HINTS = ['unsubscribe', 'promotion', 'newsletter', 'marketing'];
const SPAM_PHRASES = [
  'job alert',
  'job digest',
  'job recommendation',
  'recommended jobs',
  '你可能感兴趣',
  '职位推荐',
  '推荐岗位',
  '每日',
  '周报',
  'weekly',
  'alert',
  'digest',
];
const SPAM_DOMAINS = ['alerts.', 'marketing.', 'newsletter.', 'jobs-noreply', 'no-reply'];
const ALLOWED_EVENT_TYPES = ['submission', 'oa', 'interview', 'rejection', 'offer'];

function preprocessText(text = '') {
  const cutoffTokens = ['best regards', 'thanks,', 'thank you,', 'cheers,'];
  const lower = text.toLowerCase();
  let trimmed = text;
  cutoffTokens.forEach((token) => {
    const idx = lower.indexOf(token);
    if (idx > -1) {
      trimmed = trimmed.slice(0, idx);
    }
  });
  if (trimmed.length > 1500) {
    trimmed = trimmed.slice(0, 1500);
  }
  return trimmed;
}

function ruleRelevance({ subject = '', snippet = '', from = '' }) {
  const text = `${subject} ${snippet}`.toLowerCase();
  const hasJobKeyword = JOB_KEYWORDS.some((k) => text.includes(k));
  const hasSpamHint =
    SPAM_HINTS.some((k) => text.includes(k)) ||
    SPAM_PHRASES.some((k) => text.includes(k)) ||
    SPAM_DOMAINS.some((d) => from.toLowerCase().includes(d));
  if (hasJobKeyword && !hasSpamHint) return { isRelevant: true, confidence: 0.6 };
  if (hasSpamHint && !hasJobKeyword) return { isRelevant: false, confidence: 0.6 };
  return { isRelevant: null, confidence: 0.3 };
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            '你是一个邮件解析器，判断邮件是否与求职“申请状态更新”相关（非职位推荐/营销），并提取字段，严格输出 JSON。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn('OpenAI call failed', res.status, text);
    return null;
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    const jsonText = content.slice(jsonStart, jsonEnd + 1);
    return JSON.parse(jsonText);
  } catch (e) {
    console.warn('Failed to parse LLM JSON', e);
    return null;
  }
}

export async function processEmailForPending(message) {
  const subject = preprocessText(message.subject || '');
  const snippet = preprocessText(
    message.bodyText ? `${message.subject || ''} ${message.bodyText}` : message.snippet || ''
  );
  const from = message.from || '';

  // Rule relevance
  const relRule = ruleRelevance({ subject, snippet, from });
  if (relRule.isRelevant === false && relRule.confidence >= 0.5) {
    return { shouldCreate: false, reason: 'rule_irrelevant' };
  }

  // Rule event type
  const ruleClass = classifyEmail({ subject, snippet, from });

  let llmResult = null;
  if (!relRule.isRelevant || ruleClass.confidence < 0.5) {
    const prompt = `请判断这封邮件是否与求职申请状态更新有关（不是职位推荐/营销），并提取字段，务必输出 JSON：
{
  "isStatusUpdate": true/false,
  "eventType": "submission|oa|interview|rejection|offer",
  "company": "",
  "position": "",
  "scheduledTime": "",
  "deadline": "",
  "needsScheduling": false,
  "summary": "",
  "confidence": 0-1,
  "rationale": ""
}
邮件主题: ${subject}
发件人: ${from}
内容: ${snippet}`;
    llmResult = await callOpenAI(prompt);
  }

  // Merge rule + LLM
  const isRelevant =
    llmResult?.isStatusUpdate !== undefined
      ? llmResult.isStatusUpdate
      : relRule.isRelevant === null
        ? true
        : relRule.isRelevant;
  if (!isRelevant) {
    return { shouldCreate: false, reason: 'llm_irrelevant' };
  }

  const eventType = ALLOWED_EVENT_TYPES.includes(llmResult?.eventType)
    ? llmResult.eventType
    : ALLOWED_EVENT_TYPES.includes(ruleClass.eventType)
      ? ruleClass.eventType
      : 'other';

  if (eventType === 'other') {
    return { shouldCreate: false, reason: 'non_status_update' };
  }

  const confidence = Math.max(ruleClass.confidence || 0, llmResult?.confidence || 0.5);

  return {
    shouldCreate: true,
    parsed: {
      eventType,
      company: llmResult?.company,
      position: llmResult?.position,
      interviewTime: llmResult?.scheduledTime ? new Date(llmResult.scheduledTime) : undefined,
      deadline: llmResult?.deadline ? new Date(llmResult.deadline) : undefined,
      needsScheduling: !!llmResult?.needsScheduling,
      summary: llmResult?.summary,
      rationale: llmResult?.rationale,
      confidence,
    },
  };
}
