// Run with Node after --dir packaging. The child uses the packaged Electron runtime
// and app.asar dependencies, without importing development parser dependencies.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [target, resources, fixtures] = process.argv.slice(2);
if (target === '--runtime') {
  const root = path.join(resources, 'app.asar');
  const { parseInWorker } = await import(
    pathToFileURL(path.join(root, 'src/documents/import.mjs'))
  );
  const results = [];
  for (const [file, expected, formatted] of [
    ['登录需求.md', /连续 5 次错误/, true],
    ['需求.txt', /空密码不可提交/, false],
    ['cases.csv', /TC-01/, true],
    ['需求.html', /连续 5 次错误/, true],
    ['requirements.pdf', /Login requirements/, false],
    ['requirements.docx', /连续 5 次错误/, true],
    ['cases.xlsx', /不可提交/, true],
    ['requirements.pptx', /第一张：登录需求/, false],
  ]) {
    const value = await parseInWorker(path.join(fixtures, file));
    assert.match(value.content, expected, file);
    if (formatted) assert.ok(value.preview?.content, `${file}: formatted preview`);
    if (file.endsWith('.html')) assert.doesNotMatch(value.preview.content, /<script\b/i);
    results.push({
      file,
      characters: value.content.length,
      preview: value.preview?.format || null,
    });
  }
  const html = await readFile(path.join(resources, 'ui/index.html'), 'utf8');
  const entry = html.match(/src="\.\/([^\"]+\.js)"/);
  assert.ok(entry, 'UI entry must be a local bundled file');
  await readFile(path.join(resources, 'ui', entry[1]));
  console.log(JSON.stringify({ packagedParsers: results, localUiEntry: entry[1] }, null, 2));
} else {
  if (!target)
    throw new Error('Usage: node scripts/check-package.mjs <macOS .app or Windows .exe>');
  const appPath = path.resolve(target);
  const isMac = appPath.endsWith('.app');
  const resourcesPath = isMac
    ? path.join(appPath, 'Contents/Resources')
    : path.join(path.dirname(appPath), 'resources');
  const executable = isMac
    ? path.join(appPath, 'Contents/MacOS', path.basename(appPath, '.app'))
    : appPath;
  // macOS locale names use underscores; Windows uses hyphens. Check the real
  // packaged resources, since a successful builder exit does not prove retention.
  const locales = isMac ? ['en', 'zh_CN', 'zh_TW'] : ['en-US', 'zh-CN', 'zh-TW'];
  for (const locale of locales) {
    const localeFile = isMac
      ? path.join(
          appPath,
          'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources',
          `${locale}.lproj/locale.pak`,
        )
      : path.join(path.dirname(appPath), 'locales', `${locale}.pak`);
    await access(localeFile);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-package-'));
  try {
    const { createFixtures } = await import('../tests/fixtures.mjs');
    await createFixtures(dir);
    const result = spawnSync(
      executable,
      [fileURLToPath(import.meta.url), '--runtime', resourcesPath, dir],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'inherit',
        timeout: 180_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Packaged runtime check failed (${result.status ?? result.signal})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
