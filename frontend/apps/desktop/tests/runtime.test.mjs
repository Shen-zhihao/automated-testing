import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { prepareRuntime } from '../scripts/runtime.mjs';

const exec = promisify(execFile);

test('Windows launches its original Electron executable without preparing a macOS bundle', async () => {
  assert.equal(await prepareRuntime('electron.exe', '/unused', 'win32'), 'electron.exe');
});

test(
  'macOS local runtime uses the product name while preserving the shared runtime and credential identity',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-runtime-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'Electron.app');
    const plist = path.join(source, 'Contents/Info.plist');
    const electron = path.join(source, 'Contents/MacOS/Electron');
    await mkdir(path.dirname(electron), { recursive: true });
    const original = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>Electron</string>
<key>CFBundleExecutable</key><string>Electron</string>
<key>CFBundleVersion</key><string>44.9.1</string>
</dict></plist>`;
    await writeFile(plist, original);
    await writeFile(electron, 'fixture executable');
    await symlink('Info.plist', path.join(source, 'Contents/Info-link'));
    const appRoot = path.join(root, 'desktop');
    const prepared = await prepareRuntime(electron, appRoot, 'darwin');
    const brandedPlist = path.resolve(prepared, '../../Info.plist');
    const info = JSON.parse(
      (await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', brandedPlist])).stdout,
    );
    assert.equal(info.CFBundleName, '序舟');
    assert.equal(info.CFBundleDisplayName, '序舟');
    assert.equal(info.CFBundleIdentifier, 'Electron');
    assert.equal(info.CFBundleExecutable, 'Electron');
    assert.equal(await readFile(plist, 'utf8'), original);
    assert.equal(await readlink(path.resolve(prepared, '../../Info-link')), 'Info.plist');
    assert.equal(await readFile(prepared, 'utf8'), 'fixture executable');
    await writeFile(path.resolve(prepared, '../../cache-check'), 'retained');
    assert.equal(await prepareRuntime(electron, appRoot, 'darwin'), prepared);
    assert.equal(await readFile(path.resolve(prepared, '../../cache-check'), 'utf8'), 'retained');
    await writeFile(plist, original.replace('44.9.1', '44.9.2'));
    assert.notEqual(await prepareRuntime(electron, appRoot, 'darwin'), prepared);
  },
);
