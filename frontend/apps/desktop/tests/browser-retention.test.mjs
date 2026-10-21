import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserRetention } from '../src/testing/browser-retention.mjs';

const page = (extra = {}) => ({
  visible: false,
  closed: false,
  alive() {
    return !this.closed;
  },
  close() {
    this.closed = true;
  },
  ...extra,
});

test('idle hidden pages are retired after the deadline, but reopened pages keep their live state', (t) => {
  const first = page(),
    reopened = page();
  const browsers = new Map([
    ['first', first],
    ['reopened', reopened],
  ]);
  const retired = [];
  const retention = new BrowserRetention(browsers, {
    idleMs: 1000,
    onRetire: (id) => retired.push(id),
  });
  t.after(() => retention.dispose());
  retention.hide('first', 0);
  retention.hide('reopened', 0);
  retention.reap(999);
  assert.equal(first.closed, false);
  reopened.visible = true;
  retention.forget('reopened');
  retention.reap(1000);
  assert.equal(first.closed, true);
  assert.equal(browsers.has('first'), false);
  assert.equal(reopened.closed, false);
  assert.deepEqual(retired, ['first']);
  assert.equal(retention.timer, null);
});

test('running work, credential filling and live popup openers survive both timeout and hidden-page limits', (t) => {
  const browsers = new Map([
    ['task', page()],
    ['fill', page()],
    ['opener', page()],
    ['popup', page({ visible: true, parentId: 'opener' })],
    ['automation', page({ automationOrigin: 'https://example.com' })],
  ]);
  const busy = new Set(['task', 'fill']);
  const retention = new BrowserRetention(browsers, {
    idleMs: 1000,
    maxHidden: 1,
    isBusy: (id) => busy.has(id),
  });
  t.after(() => retention.dispose());
  for (const id of ['task', 'fill', 'opener', 'automation']) retention.hide(id, 0);
  retention.reap(2000);
  assert.equal(browsers.size, 5);
  assert.equal(
    [...browsers.values()].some((browser) => browser.closed),
    false,
  );
  busy.clear();
  browsers.get('automation').automationOrigin = null;
  browsers.get('popup').close();
  retention.reap(2001);
  assert.equal(retention.hidden.size, 0);
  assert.equal(retention.timer, null);
});

test('hidden-page overflow retires oldest idle pages and disposal clears its timer', () => {
  const browsers = new Map(['first', 'second', 'third'].map((id) => [id, page()]));
  const first = browsers.get('first');
  const retention = new BrowserRetention(browsers, { idleMs: 1000, maxHidden: 2 });
  retention.hide('first', 0);
  retention.hide('second', 1);
  retention.hide('third', 2);
  assert.equal(first.closed, true);
  assert.deepEqual([...browsers.keys()], ['second', 'third']);
  assert.ok(retention.timer);
  retention.dispose();
  assert.equal(retention.timer, null);
  assert.equal(retention.hidden.size, 0);
  assert.equal(browsers.get('second').closed, false);
});
