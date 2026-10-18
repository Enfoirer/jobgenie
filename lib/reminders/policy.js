export const LEAD_MINUTES = [15, 30, 60, 1440];
export const SNOOZE_MINUTES = 10;
export function reminderSettings(user) {
  return {
    enabled: user?.reminderSettings?.enabled !== false,
    leadMinutes: LEAD_MINUTES.includes(user?.reminderSettings?.leadMinutes) ? user.reminderSettings.leadMinutes : 60,
  };
}

// A reminder is a view of a live schedule occurrence. Reads create no queue rows
// and thus cannot duplicate delivery or leave orphaned reminders after deletion.
export function projectReminder(event, settings, now = Date.now()) {
  if (!settings.enabled || !event.time || ['offer', 'rejected'].includes(event.applicationStatus)) return null;
  const at = Date.parse(event.time), dueAt = at - settings.leadMinutes * 60000;
  if (!Number.isFinite(at) || now < dueAt || now >= at) return null;
  const saved = event.history.reminderState?.[event.kind];
  const revision = event.history.reminderRevision?.[event.kind] || 0;
  const snoozedUntil = saved?.snoozedUntil ? new Date(saved.snoozedUntil).toISOString() : null;
  const status = saved?.status === 'read' || saved?.status === 'cancelled' ? saved.status
    : saved?.status === 'snoozed' && Date.parse(snoozedUntil) > now ? 'snoozed' : 'unread';
  return {
    id: `${event.id}:${revision}`, historyId: event.historyId, jobId: event.jobId,
    kind: event.kind, revision, company: event.company, position: event.position,
    label: event.label, time: event.time, dueAt: new Date(dueAt).toISOString(), status,
    snoozedUntil: status === 'snoozed' ? snoozedUntil : null,
    canSnooze: now + SNOOZE_MINUTES * 60000 < at,
  };
}
