// Framework-independent survey state. No ratings/comments are written to browser
// storage. The legacy campaign ID deliberately matches the shipped iOS client.
export const SURVEY = 'ios-product-v1';
const DAY = 86400000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const empty = () => ({ open: false, busy: false, loading: false, error: '', notice: '', status: null, invitationId: null, formId: null });
export function validDraft(draft) {
  return ['overall', 'recommendation'].every(key => Number.isInteger(draft[key]) && draft[key] >= 1 && draft[key] <= 5)
    && typeof draft.comment === 'string' && draft.comment.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(draft.comment);
}
export function readPreference(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null');
    if (!value || !['later', 'never', 'submitted'].includes(value.action) || !uuid(value.requestId)
      || typeof value.pending !== 'boolean' || (value.invitationId != null && !uuid(value.invitationId))
      || (value.action === 'later' && !Number.isFinite(value.until))) return null;
    return value;
  } catch { return null; }
}
export class FeedbackClock {
  constructor(at = 0) { this.at = at; this.active = false; this.total = 0; this.lastInteraction = at; }
  advance(at, active) {
    // Sleeping/suspended tabs cannot gain hours of foreground use in one tick.
    if (this.active) this.total += Math.min(10000, Math.max(0, at - this.at));
    if (active !== this.active) this.lastInteraction = at;
    this.at = at; this.active = active;
  }
  interact(at) { this.lastInteraction = at; }
  ready(at) { return this.active && this.total >= 120000 && at - this.lastInteraction >= 30000; }
}
function validateStatus(value) {
  if (!value || value.campaign !== SURVEY || ['submitted', 'disabled', 'eligible'].some(key => typeof value[key] !== 'boolean')
    || (value.invitationId != null && !uuid(value.invitationId))
    || (value.response && (!validDraft(value.response) || !['manual', 'prompt'].includes(value.response.source)))) throw new Error('Unable to read feedback status. Please try again.');
  return value;
}
export async function feedbackTransport(action, body, signal) {
  const response = await fetch('/api/feedback', { method: action ? 'POST' : 'GET', cache: 'no-store', signal,
    ...(action ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, action }) } : {}) });
  if (response.status === 401) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const json = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : null;
  if (!response.ok) throw Object.assign(new Error(json?.error || 'Feedback is temporarily unavailable. Please try again.'), { status: response.status });
  return validateStatus(json);
}
export class FeedbackClient {
  constructor({ userId, storage, sessionStorage, transport = feedbackTransport, now = () => performance.now(), wall = () => Date.now(), locale = 'en', newId = () => crypto.randomUUID(), onUnauthorized = () => {} }) {
    this.userId = userId; this.storage = storage; this.sessionStorage = sessionStorage; this.transport = transport;
    this.now = now; this.wall = wall; this.locale = /^[a-zA-Z0-9._+-]{1,40}$/.test(locale) ? locale : 'en'; this.newId = newId; this.onUnauthorized = onUnauthorized;
    this.key = `jobgenie.feedback.web.${userId}.${SURVEY}`; this.sessionKey = this.key + '.session';
    this.snapshot = empty(); this.listeners = new Set(); this.controllers = new Set(); this.clock = new FeedbackClock(now());
    this.epoch = 0; this.alive = false; this.working = false; this.visitedDay = null; this.preference = null;
    this.invitationRequest = newId(); this.pendingInvitation = null; this.shownThisSession = false;
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  update(patch) { if (this.alive) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); } }
  start() {
    this.alive = true; this.epoch++; this.clock = new FeedbackClock(this.now()); this.visitedDay = null; this.working = false; this.pendingInvitation = null;
    this.preference = readPreference(this.storage, this.key);
    try {
      const stored = JSON.parse(this.sessionStorage?.getItem(this.sessionKey) || 'null');
      if (uuid(stored?.requestId)) this.invitationRequest = stored.requestId;
      this.shownThisSession = stored?.shown === true;
    } catch { /* Storage may be disabled; the server still enforces invitation limits. */ }
  }
  stop() { this.alive = false; this.epoch++; this.controllers.forEach(controller => controller.abort()); this.controllers.clear(); this.working = false; this.snapshot = empty(); }
  interact() { this.clock.interact(this.now()); }
  syncStorage() {
    this.preference = readPreference(this.storage, this.key);
    if (this.snapshot.invitationId && ['never', 'submitted', 'later'].includes(this.preference?.action)) this.update({ open: false, invitationId: null });
  }
  savePreference(value) {
    this.preference = value;
    try { this.storage?.setItem(this.key, JSON.stringify(value)); return Boolean(this.storage); } catch { return false; }
  }
  rememberSession() {
    try { this.sessionStorage?.setItem(this.sessionKey, JSON.stringify({ requestId: this.invitationRequest, shown: this.shownThisSession })); } catch { /* Optional local suppression, not the authoritative limit. */ }
  }
  applyStatus(value) {
    const previous = this.snapshot.status;
    const status = { ...value, submitted: value.submitted || previous?.submitted === true, disabled: value.disabled || previous?.disabled === true, response: value.response || previous?.response || null };
    this.update({ status }); return status;
  }
  async call(action = null, body = {}) {
    if (!this.alive) throw new DOMException('Feedback view closed', 'AbortError');
    const epoch = this.epoch, controller = new AbortController(); this.controllers.add(controller);
    try {
      const value = validateStatus(await this.transport(action, { ...body, platform: 'web', appVersion: '0.1.0', locale: this.locale }, controller.signal));
      if (!this.alive || epoch !== this.epoch) throw new DOMException('Feedback view closed', 'AbortError');
      return value;
    } catch (error) {
      if (this.alive && epoch === this.epoch && error.status === 401) { this.stop(); this.listeners.forEach(listener => listener()); this.onUnauthorized(); }
      throw error;
    } finally { this.controllers.delete(controller); }
  }
  async syncPreference() {
    const preference = this.preference;
    if (!preference?.pending || !['later', 'never'].includes(preference.action)) return;
    try {
      const value = await this.call(preference.action, { requestId: preference.requestId, ...(preference.invitationId ? { invitationId: preference.invitationId } : {}) });
      if (this.preference?.requestId !== preference.requestId) return;
      this.applyStatus(value); this.savePreference({ ...preference, pending: false });
      this.update({ notice: preference.action === 'never' ? 'Automatic feedback invitations are off. You can still use Feedback to share your thoughts.' : 'Not now. Automatic invitations are paused for at least 14 days.' });
    } catch { /* Local choice already applies. Retry on reconnect or next active visit. */ }
  }
  canPrompt() {
    const status = this.snapshot.status;
    return this.alive && !this.snapshot.open && !this.snapshot.busy && !this.shownThisSession
      && !['never', 'submitted'].includes(this.preference?.action) && !(this.preference?.until > this.wall())
      && status && !status.submitted && !status.disabled && this.clock.ready(this.now());
  }
  async tick({ active, safe }) {
    this.clock.advance(this.now(), active());
    if (!this.alive || !active() || this.working) return;
    this.working = true; const epoch = this.epoch;
    try {
      await this.syncPreference();
      if (!this.alive || epoch !== this.epoch) return;
      const day = new Date(this.wall()).toISOString().slice(0, 10);
      if (this.visitedDay !== day) { this.applyStatus(await this.call('visit')); this.visitedDay = day; }
      if (!safe()) { this.interact(); return; }
      if (!this.canPrompt() || (!this.snapshot.status.eligible && !this.pendingInvitation)) return;
      this.rememberSession();
      const value = await this.call('invite', { requestId: this.invitationRequest }); this.applyStatus(value); this.pendingInvitation = value.invitationId;
      if (!this.pendingInvitation || !active() || !safe() || !this.canPrompt()) return;
      this.shownThisSession = true; this.rememberSession();
      this.update({ open: true, formId: this.newId(), invitationId: this.pendingInvitation, error: '', notice: '' });
    } catch { /* An optional automatic invitation must never interrupt normal use on failure. */ }
    finally { if (epoch === this.epoch) this.working = false; }
  }
  async openManual() {
    if (!this.alive || this.snapshot.open || this.snapshot.busy) return;
    const formId = this.newId(); this.update({ open: true, formId, invitationId: null, loading: true, error: '', notice: '' });
    try { const value = await this.call(); if (this.snapshot.formId === formId && this.snapshot.open) this.applyStatus(value); }
    catch (error) { if (error.name !== 'AbortError' && this.snapshot.formId === formId) this.update({ error: error.message }); }
    finally { if (this.snapshot.formId === formId) this.update({ loading: false }); }
  }
  async shown() {
    const id = this.snapshot.invitationId;
    if (!this.snapshot.open || !id) return;
    const value = await this.call('shown', { invitationId: id }); const status = this.applyStatus(value);
    if (status.submitted || status.disabled) this.update({ open: false, invitationId: null });
  }
  async dismiss(action = 'later') {
    if (!this.alive || !this.snapshot.open || this.snapshot.busy) return;
    const invitationId = this.snapshot.invitationId;
    this.shownThisSession = true; this.rememberSession();
    this.update({ open: false, invitationId: null, error: '' });
    if (action === 'later' && this.snapshot.status?.submitted) return;
    let saved = true;
    if (this.preference?.action !== 'never') saved = this.savePreference({ action, requestId: this.newId(), invitationId, until: action === 'later' ? this.wall() + 14 * DAY : null, pending: true });
    this.update({ notice: saved ? (action === 'never' ? 'Automatic invitations are off on this browser. Your choice will sync when connected.' : 'Not now. No automatic invitation for at least 14 days. Your choice will sync when connected.')
      : 'Invitations are paused for this visit. Browser storage is unavailable; reconnect to save your choice to your account.' });
    await this.syncPreference();
  }
  async submit(draft) {
    if (!this.alive || !this.snapshot.open || this.snapshot.busy || !validDraft(draft)) return;
    const id = this.snapshot.invitationId, formId = this.snapshot.formId;
    this.update({ busy: true, error: '' });
    try {
      if (id) this.applyStatus(await this.call('shown', { invitationId: id }));
      const value = await this.call('submit', { ...draft, ...(id ? { invitationId: id } : {}) });
      if (!value.submitted) throw new Error('Feedback was not confirmed. Please try again.');
      this.applyStatus(value);
      if (this.preference?.action !== 'never') this.savePreference({ action: 'submitted', requestId: this.newId(), pending: false });
      this.shownThisSession = true; this.rememberSession();
      this.update({ open: false, invitationId: null, notice: 'Thank you. Your feedback has been saved.' });
    } catch (error) { if (error.name !== 'AbortError') this.update({ error: error.message || 'Feedback could not be sent. Check your connection and try again.' }); }
    finally { if (this.snapshot.formId === formId) this.update({ busy: false }); }
  }
}
