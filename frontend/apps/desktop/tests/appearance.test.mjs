import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from '../src/store.mjs';
import { AppearanceService, windowBackground } from '../src/appearance.mjs';

class NativeThemeFixture extends EventEmitter {
  constructor(dark = false) {
    super();
    this.osDark = dark;
    this.source = 'system';
  }
  set themeSource(mode) {
    this.source = mode;
    this.emit('updated');
  }
  get themeSource() {
    return this.source;
  }
  get shouldUseDarkColors() {
    return this.source === 'system' ? this.osDark : this.source === 'dark';
  }
  systemDark(dark) {
    this.osDark = dark;
    this.emit('updated');
  }
}

test('appearance follows system changes, manual choices override them, and returning to system uses the latest OS theme', () => {
  const store = new WorkspaceStore(':memory:'),
    native = new NativeThemeFixture(),
    updates = [];
  const appearance = new AppearanceService(store, native, {
    onChanged: (value) => updates.push(value),
  });
  try {
    assert.deepEqual(appearance.public(), { mode: 'system', theme: 'light' });
    native.systemDark(true);
    assert.deepEqual(updates.at(-1), { mode: 'system', theme: 'dark' });
    appearance.set('light');
    native.systemDark(false);
    native.systemDark(true);
    assert.deepEqual(appearance.public(), { mode: 'light', theme: 'light' });
    appearance.set('dark');
    native.systemDark(false);
    assert.deepEqual(appearance.public(), { mode: 'dark', theme: 'dark' });
    appearance.set('system');
    assert.deepEqual(appearance.public(), { mode: 'system', theme: 'light' });
    assert.notEqual(windowBackground('dark'), windowBackground('light'));
  } finally {
    appearance.close();
    store.close();
  }
});

test('appearance persists across restarts without changing models, encrypted credentials or project data', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'appearance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'data.sqlite');
  let store = new WorkspaceStore(file);
  const settings = {
    model: { model: 'fixture' },
    apiKey: 'encrypted-key',
    feishu: { appSecret: 'encrypted-secret' },
  };
  store.writeSettings(settings);
  const project = store.projects.create({ name: '保留工程' });
  let appearance = new AppearanceService(store, new NativeThemeFixture());
  appearance.set('dark');
  appearance.close();
  store.close();
  store = new WorkspaceStore(file);
  const native = new NativeThemeFixture(false);
  appearance = new AppearanceService(store, native);
  try {
    assert.deepEqual(appearance.public(), { mode: 'dark', theme: 'dark' });
    assert.equal(native.themeSource, 'dark');
    assert.deepEqual(store.readSettings(), settings);
    assert.equal(store.projects.get(project.id).name, '保留工程');
  } finally {
    appearance.close();
    store.close();
  }
});

test('invalid input or failed persistence keeps the previous appearance and does not silently switch native UI', () => {
  const store = new WorkspaceStore(':memory:'),
    native = new NativeThemeFixture(),
    appearance = new AppearanceService(store, native);
  try {
    appearance.set('light');
    for (const mode of [null, {}, '', 'automatic', 'DARK'])
      assert.throws(() => appearance.set(mode), /外观模式无效/);
    store.db.exec('PRAGMA query_only=ON');
    assert.throws(() => appearance.set('dark'));
    assert.deepEqual(appearance.public(), { mode: 'light', theme: 'light' });
    assert.equal(native.themeSource, 'light');
  } finally {
    appearance.close();
    store.close();
  }
});

test('bad legacy appearance values fall back to system and lifecycle cleanup removes native listeners', () => {
  const store = new WorkspaceStore(':memory:'),
    native = new NativeThemeFixture(true);
  let updates = 0;
  store.db.prepare('INSERT INTO settings VALUES (?,?)').run('appearance', '{invalid');
  const appearance = new AppearanceService(store, native, { onChanged: () => updates++ });
  assert.deepEqual(appearance.public(), { mode: 'system', theme: 'dark' });
  assert.equal(native.listenerCount('updated'), 1);
  appearance.close();
  native.systemDark(false);
  assert.equal(native.listenerCount('updated'), 0);
  assert.equal(updates, 0);
  store.close();
});

test('all UI color tokens exist in both palettes, and key text/status pairs stay readable in each mode', async () => {
  const root = fileURLToPath(new URL('../../agent-web/src/', import.meta.url));
  const theme = await readFile(path.join(root, 'styles/theme.less'), 'utf8');
  const blocks = [...theme.matchAll(/\.(lightPalette|darkPalette)\(\)\s*\{([\s\S]*?)\n\}/g)];
  assert.equal(blocks.length, 2);
  const palettes = blocks.map((match) =>
    Object.fromEntries(
      [...match[2].matchAll(/--([\w-]+):\s*(#[a-f\d]+);/g)].map((entry) => [entry[1], entry[2]]),
    ),
  );
  assert.deepEqual(Object.keys(palettes[0]).sort(), Object.keys(palettes[1]).sort());
  const luminance = (hex) =>
    hex
      .slice(1)
      .match(/../g)
      .map((value) => parseInt(value, 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const palette of palettes)
    for (const [foreground, background] of [
      ['text-primary', 'surface-primary'],
      ['text-secondary', 'surface-primary'],
      ['text-muted', 'surface-secondary'],
      ['text-accent', 'surface-accent'],
      ['on-accent', 'accent'],
      ['success', 'surface-success'],
      ['warning', 'surface-warning'],
      ['danger', 'surface-danger'],
    ]) {
      const [a, b] = [luminance(palette[foreground]), luminance(palette[background])].sort(
        (a, b) => a - b,
      );
      assert.ok((b + 0.05) / (a + 0.05) >= 4.5, `${foreground} on ${background}`);
    }
  const files = [];
  const collect = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (file.endsWith('.less')) files.push(file);
    }
  };
  await collect(root);
  const styles = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  const defined = new Set([...styles.matchAll(/(--[\w-]+):/g)].map((match) => match[1]));
  for (const match of styles.matchAll(/var\((--[\w-]+)/g))
    assert.ok(defined.has(match[1]), `missing ${match[1]}`);
});
