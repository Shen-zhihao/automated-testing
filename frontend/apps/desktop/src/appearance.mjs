const modes = new Set(['system', 'light', 'dark']);
export const windowBackground = (theme) => (theme === 'dark' ? '#141414' : '#ffffff');
export const titleBarOverlay = (theme) => ({
  color: theme === 'dark' ? '#101010' : '#f8f8f8',
  symbolColor: theme === 'dark' ? '#cccccc' : '#3b3b3b',
  height: 40,
});
export function windowChrome(theme, platform = process.platform) {
  return {
    titleBarStyle: 'hidden',
    ...(platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: titleBarOverlay(theme) }),
  };
}
export function applyWindowAppearance(window, theme, platform = process.platform) {
  window.setBackgroundColor(windowBackground(theme));
  if (platform === 'win32') window.setTitleBarOverlay(titleBarOverlay(theme));
}

// Client-wide appearance is stored independently of model and encrypted credentials.
export class AppearanceService {
  constructor(store, nativeTheme, { onChanged = () => {} } = {}) {
    Object.assign(this, { store, nativeTheme, onChanged });
    let saved;
    try {
      saved = JSON.parse(
        store.db.prepare('SELECT value FROM settings WHERE key=?').get('appearance')?.value ||
          'null',
      );
    } catch {
      saved = null;
    }
    this.mode = modes.has(saved?.mode) ? saved.mode : 'system';
    this.nativeTheme.themeSource = this.mode;
    this.listener = () => this.onChanged(this.public());
    this.nativeTheme.on('updated', this.listener);
  }
  public() {
    return { mode: this.mode, theme: this.nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
  }
  set(mode) {
    if (!modes.has(mode)) throw new Error('外观模式无效，请选择跟随系统、浅色或深色。');
    this.store.db
      .prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')
      .run('appearance', JSON.stringify({ mode }));
    this.mode = mode;
    this.nativeTheme.themeSource = mode;
    this.onChanged(this.public());
    return this.public();
  }
  close() {
    this.nativeTheme.removeListener('updated', this.listener);
  }
}
