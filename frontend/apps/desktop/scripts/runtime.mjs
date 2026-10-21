import { constants } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { APP_DISPLAY_NAME } from '../src/menu.mjs';

const exec = promisify(execFile);

/** 本地启动使用独立的 macOS 外壳副本，不修改共享 Electron 或系统凭据身份。 */
export async function prepareRuntime(electron, appRoot, platform = process.platform) {
  if (platform !== 'darwin') return electron;
  const source = path.resolve(electron, '../../..');
  const sourcePlist = path.join(source, 'Contents/Info.plist');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        1,
        source,
        APP_DISPLAY_NAME,
        (await stat(sourcePlist)).mtimeMs,
        await readFile(sourcePlist, 'utf8'),
      ]),
    )
    .digest('hex')
    .slice(0, 20);
  const cache = path.join(appRoot, 'node_modules/.cache/desktop-runtime');
  const target = path.join(cache, fingerprint);
  const bundleName = `${APP_DISPLAY_NAME}.app`;
  const executable = path.join(target, bundleName, 'Contents/MacOS', path.basename(electron));
  try {
    await access(path.join(target, 'ready'));
    await access(executable);
    return executable;
  } catch {
    // 首次启动或 Electron 升级后重新准备；不复用未完成的副本。
  }
  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(path.join(cache, '.preparing-'));
  try {
    const bundle = path.join(staging, bundleName);
    await cp(source, bundle, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    const plist = path.join(bundle, 'Contents/Info.plist');
    const info = JSON.parse(
      (await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist])).stdout,
    );
    for (const key of ['CFBundleName', 'CFBundleDisplayName'])
      await exec('/usr/bin/plutil', [
        key in info ? '-replace' : '-insert',
        key,
        '-string',
        APP_DISPLAY_NAME,
        plist,
      ]);
    // 保留 Bundle ID、可执行文件名和 app.setName，safeStorage 与旧数据目录继续使用原身份。
    await writeFile(path.join(staging, 'ready'), fingerprint);
    try {
      await rename(staging, target);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      await access(path.join(target, 'ready'));
    }
    return executable;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
