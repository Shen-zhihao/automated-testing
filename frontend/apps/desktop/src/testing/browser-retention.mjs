// Closing a tab only hides it. Idle hidden pages are reclaimed later; active tasks and
// opener pages with live children stay alive. Cookies remain in the persistent session.
export class BrowserRetention {
  constructor(
    browsers,
    { isBusy = () => false, onRetire = () => {}, idleMs = 5 * 60_000, maxHidden = 6 } = {},
  ) {
    Object.assign(this, { browsers, isBusy, onRetire, idleMs, maxHidden });
    this.hidden = new Map();
    this.timer = null;
  }
  hide(id, time = Date.now()) {
    this.hidden.set(id, time);
    this.reap(time);
    if (this.hidden.size && !this.timer) {
      this.timer = setInterval(() => this.reap(), Math.min(this.idleMs, 60_000));
      this.timer.unref?.();
    }
  }
  forget(id) {
    this.hidden.delete(id);
    if (!this.hidden.size) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  protected(id) {
    const browser = this.browsers.get(id);
    return (
      browser?.visible ||
      browser?.automationOrigin ||
      this.isBusy(id) ||
      [...this.browsers.values()].some((child) => child.parentId === id && child.alive())
    );
  }
  reap(time = Date.now()) {
    for (const [id, hiddenAt] of this.hidden) {
      const browser = this.browsers.get(id);
      if (!browser?.alive()) {
        this.browsers.delete(id);
        this.forget(id);
        continue;
      }
      if (this.protected(id)) continue;
      if (time - hiddenAt < this.idleMs && this.hidden.size <= this.maxHidden) continue;
      // Delete before close: native destruction can synchronously notify the UI.
      this.browsers.delete(id);
      this.forget(id);
      browser.close();
      this.onRetire(id);
    }
  }
  dispose() {
    clearInterval(this.timer);
    this.timer = null;
    this.hidden.clear();
  }
}
