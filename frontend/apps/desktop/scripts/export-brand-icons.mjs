import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// These are image-format exports only; the master artwork is not modified.
if (process.platform !== 'darwin')
  throw new Error('请在 macOS 上导出图标；Windows 打包直接使用仓库中已导出的图标。');

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const brandRoot = path.join(appRoot, 'assets/brand');
const webRoot = path.resolve(appRoot, '../agent-web/public/brand');
const source = path.join(brandRoot, 'icon.png');
const original = await readFile(source);
if (
  !original.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
  original.readUInt32BE(16) !== original.readUInt32BE(20) ||
  original.readUInt32BE(16) < 1024
)
  throw new Error('母版必须为至少 1024 × 1024 的正方形 PNG。');

const temporary = await mkdtemp(path.join(os.tmpdir(), 'xuzhou-icons-'));
const iconset = path.join(temporary, 'icon.iconset');
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} 导出失败：${result.stderr || result.stdout}`);
}
try {
  await mkdir(iconset);
  await mkdir(webRoot, { recursive: true });
  const pngs = new Map();
  for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 180, 256, 512, 1024]) {
    const file = path.join(temporary, `${size}.png`);
    run('sips', ['-z', String(size), String(size), source, '--out', file]);
    pngs.set(size, file);
  }
  for (const size of [16, 32, 128, 256, 512]) {
    await copyFile(pngs.get(size), path.join(iconset, `icon_${size}x${size}.png`));
    await copyFile(pngs.get(size * 2), path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', path.join(brandRoot, 'icon.icns')]);
  await copyFile(pngs.get(512), path.join(brandRoot, 'icon-runtime.png'));

  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const frames = await Promise.all(sizes.map((size) => readFile(pngs.get(size))));
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(frame.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(path.join(brandRoot, 'icon.ico'), Buffer.concat([directory, ...frames]));
  for (const [size, name] of [
    [128, 'icon.png'],
    [64, 'favicon.png'],
    [180, 'apple-touch-icon.png'],
  ])
    await copyFile(pngs.get(size), path.join(webRoot, name));
  console.log('已导出序舟 macOS / Windows 图标与网页资源。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
