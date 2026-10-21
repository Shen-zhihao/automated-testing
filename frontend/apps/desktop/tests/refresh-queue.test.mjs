import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../../agent-web/src/utils/refresh-queue.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('a burst before the read starts produces just one snapshot', async () => {
  let reads = 0;
  const values = [];
  const queue = createRefreshQueue(
    async () => ++reads,
    (value) => values.push(value),
  );
  await Promise.all(Array.from({ length: 100 }, () => queue.request()));
  assert.equal(reads, 1);
  assert.deepEqual(values, [1]);
});

test('changes during a slow read coalesce into one trailing read without overlap or lost writes', async () => {
  const first = deferred(),
    second = deferred();
  const values = [];
  let reads = 0,
    active = 0,
    maximum = 0;
  const queue = createRefreshQueue(
    async () => {
      maximum = Math.max(maximum, ++active);
      const result = await (++reads === 1 ? first.promise : second.promise);
      active--;
      return result;
    },
    (value) => values.push(value),
  );
  const initial = queue.request();
  await Promise.resolve();
  const waiting = Array.from({ length: 100 }, () => queue.request());
  first.resolve('old');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2);
  second.resolve('latest');
  await Promise.all([initial, ...waiting]);
  assert.equal(maximum, 1);
  assert.deepEqual(values, ['old', 'latest']);
});

test('a failed read still processes pending changes and later explicit refreshes', async () => {
  const first = deferred();
  const errors = [],
    values = [];
  let reads = 0;
  const queue = createRefreshQueue(
    async () => (++reads === 1 ? first.promise : reads),
    (value) => values.push(value),
    (error) => errors.push(error.message),
  );
  const pending = queue.request();
  await Promise.resolve();
  const trailing = queue.request();
  first.reject(new Error('temporary failure'));
  await Promise.all([pending, trailing]);
  await queue.request();
  assert.deepEqual(errors, ['temporary failure']);
  assert.deepEqual(values, [2, 3]);
});

test('disposing a project drops its stale result and queued work, and the next project refreshes normally', async () => {
  const old = deferred();
  const values = [];
  let reads = 0;
  const previous = createRefreshQueue(
    async () => {
      reads++;
      return old.promise;
    },
    (value) => values.push(value),
  );
  const pending = previous.request();
  await Promise.resolve();
  void previous.request();
  previous.dispose();
  const next = createRefreshQueue(
    async () => 'new-project',
    (value) => values.push(value),
  );
  await next.request();
  old.resolve('old-project');
  await pending;
  await previous.request();
  assert.equal(reads, 1);
  assert.deepEqual(values, ['new-project']);
});

test('disposed queued work never starts and synchronous follow-up notifications are retained', async () => {
  let reads = 0;
  const disposed = createRefreshQueue(
    async () => ++reads,
    () => assert.fail('disposed'),
  );
  const pending = disposed.request();
  disposed.dispose();
  await pending;
  assert.equal(reads, 0);
  const values = [];
  const queue = createRefreshQueue(
    async () => ++reads,
    (value) => {
      values.push(value);
      if (value === 1) void queue.request();
    },
  );
  await queue.request();
  assert.deepEqual(values, [1, 2]);
});
