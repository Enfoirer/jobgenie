import { randomUUID } from 'node:crypto';
import User from '../models/User.js';
import FeedbackProfile from '../models/FeedbackProfile.js';
import ProductFeedback from '../models/ProductFeedback.js';
import { withUserMutation, jobError } from '../jobs/jobMutations.js';

// Keep the original ID so shipped iOS clients and web share one survey/response.
export const FEEDBACK_CAMPAIGN = 'ios-product-v1';
export const feedbackPolicy = Object.freeze({ minimumDays: 7, minimumActiveDays: 3, cooldownDays: 14, maximumInvitations: 2 });
const day = 86400000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) jobError('Expected an object');
  const common = ['action', 'appVersion', 'locale', 'platform'];
  const fields = { visit: [], invite: ['requestId'], shown: ['invitationId'], later: ['invitationId', 'requestId'], never: ['invitationId', 'requestId'], submit: ['invitationId', 'overall', 'recommendation', 'comment'] };
  if (!Object.hasOwn(fields, data.action) || Object.keys(data).some(key => ![...common, ...fields[data.action]].includes(key))) jobError('Invalid feedback action or fields');
  for (const key of ['appVersion', 'locale']) if (data[key] !== undefined && (typeof data[key] !== 'string' || !/^[a-zA-Z0-9._+-]{1,40}$/.test(data[key]))) jobError('Invalid feedback context');
  if (data.platform !== undefined && !['ios', 'web'].includes(data.platform)) jobError('Invalid feedback platform');
  if (['invite', 'later', 'never'].includes(data.action) && !uuid(data.requestId)) jobError('Invalid feedback request');
  if (data.invitationId !== undefined && !uuid(data.invitationId)) jobError('Invalid invitation');
  if (data.action === 'shown' && !data.invitationId) jobError('An invitation is required');
  if (data.action === 'submit') {
    for (const key of ['overall', 'recommendation']) if (!Number.isInteger(data[key]) || data[key] < 1 || data[key] > 5) jobError('Choose between one and five stars for both questions');
    if (data.comment !== undefined && (typeof data.comment !== 'string' || data.comment.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.comment))) jobError('Comments must be at most 2000 characters');
  }
}
function activeDays(profile, now) {
  const earliest = new Date(now - 29 * day).toISOString().slice(0, 10);
  return (profile?.activeDays || []).filter(value => value >= earliest && value <= new Date(now).toISOString().slice(0, 10));
}
function result(profile, feedback, now) {
  const submitted = Boolean(profile?.submittedAt || feedback);
  const disabled = Boolean(profile?.disabledAt);
  return {
    campaign: FEEDBACK_CAMPAIGN, serverTime: new Date(now).toISOString(),
    submitted, disabled, snoozedUntil: profile?.snoozedUntil?.toISOString() || null,
    eligible: Boolean(profile && now - profile.firstSeenAt.getTime() >= feedbackPolicy.minimumDays * day
      && activeDays(profile, now).length >= feedbackPolicy.minimumActiveDays && !submitted && !disabled
      && !(profile.snoozedUntil?.getTime() > now) && profile.invitations.length < feedbackPolicy.maximumInvitations),
    response: feedback ? { overall: feedback.overall, recommendation: feedback.recommendation, comment: feedback.comment, source: feedback.source, platform: feedback.platform || 'ios', createdAt: feedback.createdAt.toISOString() } : null,
    policy: feedbackPolicy,
  };
}
export async function feedbackStatus(userId, now = Date.now()) {
  if (!await User.exists({ _id: userId })) jobError('User not found', 404);
  const [profile, feedback] = await Promise.all([FeedbackProfile.findById(userId), ProductFeedback.findById(`${userId}:${FEEDBACK_CAMPAIGN}`)]);
  return result(profile, feedback, now);
}
export async function feedbackAction(userId, data, now = Date.now()) {
  validate(data);
  return withUserMutation(userId, async session => {
    let profile = await FeedbackProfile.findById(userId).session(session);
    if (!profile) profile = new FeedbackProfile({ _id: userId, campaign: FEEDBACK_CAMPAIGN, firstSeenAt: new Date(now), activeDays: [] });
    let feedback = await ProductFeedback.findById(`${userId}:${FEEDBACK_CAMPAIGN}`).session(session);
    let invitation;
    if (data.invitationId) {
      invitation = profile.invitations.find(item => item.id === data.invitationId);
      if (!invitation) jobError('Feedback invitation is unavailable', 404);
    }
    let offered = null;
    if (data.action === 'visit') {
      profile.activeDays = [...new Set([...activeDays(profile, now), new Date(now).toISOString().slice(0, 10)])].sort();
    } else if (data.action === 'invite') {
      // Same request retries return the original offer without consuming another.
      const previous = profile.invitations.find(item => item.requestId === data.requestId && item.disposition === 'offered');
      if (previous && !profile.disabledAt && !feedback && !profile.submittedAt) offered = previous;
      else if (result(profile, feedback, now).eligible) {
        offered = { id: randomUUID(), requestId: data.requestId, offeredAt: new Date(now), disposition: 'offered', appVersion: data.appVersion, locale: data.locale, platform: data.platform || 'ios' };
        profile.invitations.push(offered);
        profile.snoozedUntil = new Date(now + feedbackPolicy.cooldownDays * day);
      }
    } else if (data.action === 'shown') {
      invitation.shownAt ||= new Date(now);
      if (invitation.disposition === 'offered') invitation.disposition = 'shown';
    } else if (data.action === 'never') {
      profile.disabledAt ||= new Date(now);
      if (invitation && invitation.disposition !== 'submitted') { invitation.shownAt ||= new Date(now); invitation.disposition = 'never'; invitation.respondedAt ||= new Date(now); }
    } else if (data.action === 'later') {
      // Stale/repeated dismissals cannot undo opt-out, submission or extend a snooze.
      if (!profile.disabledAt && !profile.submittedAt && profile.lastLaterRequestId !== data.requestId && (!invitation || ['offered', 'shown'].includes(invitation.disposition))) {
        profile.snoozedUntil = new Date(Math.max(profile.snoozedUntil?.getTime() || 0, now + feedbackPolicy.cooldownDays * day));
        if (invitation) { invitation.shownAt ||= new Date(now); invitation.disposition = 'later'; invitation.respondedAt = new Date(now); }
        else profile.manualLaterCount++;
        // A manual dismissal on either client also defers unshown reservations
        // held by another device. It does not claim that those offers were seen.
        if (!invitation) for (const item of profile.invitations) {
          if (item.disposition === 'offered') { item.disposition = 'later'; item.respondedAt = new Date(now); }
        }
        profile.lastLaterRequestId = data.requestId;
      }
    } else if (data.action === 'submit' && !feedback) {
      // Low and high ratings follow exactly the same persistence path. No review gating.
      if (invitation && !invitation.shownAt) jobError('Show the invitation before submitting', 409);
      feedback = (await ProductFeedback.create([{
        _id: `${userId}:${FEEDBACK_CAMPAIGN}`, userId, campaign: FEEDBACK_CAMPAIGN,
        overall: data.overall, recommendation: data.recommendation, comment: (data.comment || '').trim(),
        source: invitation ? 'prompt' : 'manual', invitationId: invitation?.id,
        appVersion: data.appVersion, locale: data.locale, platform: data.platform || 'ios', createdAt: new Date(now),
        activeDayCount: activeDays(profile, now).length, daysSinceFirstSeen: Math.max(0, Math.floor((now - profile.firstSeenAt.getTime()) / day)),
      }], { session }))[0];
      profile.submittedAt = new Date(now);
      if (invitation) { invitation.disposition = 'submitted'; invitation.respondedAt = new Date(now); }
    }
    await profile.save({ session });
    return { ...result(profile, feedback, now), invitationId: offered?.id || null };
  });
}
