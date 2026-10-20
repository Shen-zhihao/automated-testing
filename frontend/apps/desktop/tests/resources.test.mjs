import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { APP_URL, DEV_URL, isAppNavigation, resolveUiResource } from '../src/resources.mjs';

for (const [name, pathApi, root] of [
  ['macOS', path.posix, '/Applications/Test Agent.app/Contents/Resources/ui'],
  ['Windows', path.win32, 'C:\\Program Files\\Test Agent\\resources\\ui'],
]) {
  test(`${name}: serve bundled UI and reject paths outside it`, () => {
    assert.equal(resolveUiResource(root, APP_URL, pathApi), pathApi.join(root, 'index.html'));
    assert.equal(
      resolveUiResource(root, 'test-agent://app/assets/app.js', pathApi),
      pathApi.join(root, 'assets', 'app.js'),
    );
    for (const url of [
      'test-agent://app/%2e%2e%2fsecret.txt',
      'test-agent://app/%5c..%5csecret.txt',
      'test-agent://app/%00secret.txt',
      'test-agent://app/%zz',
      'test-agent://outside/index.html',
      'test-agent://app:123/index.html',
      'https://app/index.html',
    ])
      assert.equal(resolveUiResource(root, url, pathApi), null, url);
  });
}

test('navigation stays within the app document, including hash routes', () => {
  assert.equal(isAppNavigation(`${APP_URL}#/tasks/1`, false), true);
  assert.equal(isAppNavigation(`${DEV_URL}#/chat`, true), true);
  for (const url of ['https://example.com', 'file:///etc/passwd', `${APP_URL}/other`, DEV_URL]) {
    assert.equal(isAppNavigation(url, false), false);
  }
  assert.equal(isAppNavigation(APP_URL, true), false);
});
