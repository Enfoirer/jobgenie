const isChoice = value => ['completed', 'skipped'].includes(value);

export class OnboardingClient {
  constructor({ userId, fetcher = (...args) => fetch(...args), storage = null }) {
    this.key = `jobgenie:web-onboarding:v1:${userId}`;
    this.fetcher = fetcher;
    this.storage = storage;
    this.listeners = new Set();
    this.state = { eligible: false, open: false, manual: false, notice: '', saving: false };
    this.handled = false;
    this.choice = null;
    this.active = false;
    this.controller = null;
    this.saveRequest = null;
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  update(values) { this.state = { ...this.state, ...values }; this.listeners.forEach(listener => listener()); }
  readChoice() {
    try { const value = this.storage?.getItem(this.key); return isChoice(value) ? value : null; }
    catch { return null; }
  }
  start() {
    this.active = true;
    this.controller = new AbortController();
    this.choice ||= this.readChoice();
    if (this.choice) { this.handled = true; return this.save(); }
    return this.refresh();
  }
  stop() { this.active = false; this.controller?.abort(); this.saveRequest = null; }
  async refresh() {
    if (!this.active) return;
    this.choice ||= this.readChoice();
    if (this.choice) {
      this.handled = true;
      this.update({ eligible: false, open: this.state.open && this.state.manual });
      return this.save();
    }
    const controller = this.controller;
    try {
      const response = await this.fetcher('/api/onboarding', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) return;
      const data = await response.json();
      if (!this.active || this.controller !== controller) return;
      if (isChoice(data.outcome)) this.handled = true;
      const eligible = !this.handled && data.eligible === true;
      this.update({ eligible, open: this.state.open && (this.state.manual || eligible) });
    } catch { /* Retry on focus, visibility or reconnection without blocking the dashboard. */ }
  }
  show() { if (this.active && this.state.eligible && !this.handled && !this.state.open) this.update({ open: true, manual: false }); }
  showManual() { if (this.active && !this.state.open) this.update({ open: true, manual: true }); }
  finish(action) {
    if (!this.active || !isChoice(action)) return;
    this.update({ open: false, manual: false });
    if (this.handled) return;
    this.handled = true;
    this.choice = action;
    try { this.storage?.setItem(this.key, action); } catch { /* The online account write still works. */ }
    this.update({ eligible: false, open: false });
    return this.save();
  }
  async save() {
    if (!this.active || !this.choice) return;
    if (this.saveRequest) return this.saveRequest;
    const controller = this.controller;
    this.update({ saving: true });
    const request = (async () => {
      try {
        const response = await this.fetcher('/api/onboarding', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: this.choice }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error('Guide preference unavailable');
        const data = await response.json();
        if (!isChoice(data.outcome)) throw new Error('Invalid guide preference');
        if (!this.active || this.controller !== controller) return;
        this.choice = null;
        try { this.storage?.removeItem(this.key); } catch { /* A retained choice is safe to replay. */ }
        this.update({ notice: '', saving: false });
      } catch {
        if (this.active && this.controller === controller) this.update({ saving: false, notice: 'Your guide choice could not be saved to your account. You can keep using JobGenie and retry.' });
      }
    })();
    this.saveRequest = request;
    try { await request; }
    finally { if (this.saveRequest === request) this.saveRequest = null; }
  }
}
