import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrototypeClient } from '../dist/index.js';

test('messages and deletion stay within the selected conversation', () => {
  const client = createPrototypeClient();
  const first = client.createSession();
  const second = client.createSession();
  client.sendMessage(first.id, '检查登录页面', [1]);
  client.sendMessage(second.id, '检查接口', []);
  const sessions = client.getSnapshot().sessions;
  assert.equal(
    sessions.find((session) => session.id === first.id).messages[0].content,
    '检查登录页面',
  );
  assert.equal(
    sessions.find((session) => session.id === second.id).messages[0].content,
    '检查接口',
  );
  assert.match(
    sessions.find((session) => session.id === first.id).messages[1].content,
    /测试用例设计/,
  );
  assert.doesNotMatch(
    sessions.find((session) => session.id === second.id).messages[1].content,
    /本次选择的模板/,
  );
  client.deleteSession(first.id);
  assert.deepEqual(
    client.getSnapshot().sessions.map((session) => session.id),
    [second.id],
  );
  assert.throws(() => client.sendMessage(first.id, '已删除', []), /对话不存在/);
});

test('a new client starts empty and task drafts never imply execution', () => {
  const client = createPrototypeClient();
  const task = client.createTask({ name: '  冒烟测试  ', kind: 'ui', target: '  /login  ' });
  assert.equal(task.name, '冒烟测试');
  assert.equal(task.target, '/login');
  assert.equal(task.status, 'draft');
  assert.equal(client.getSnapshot().tasks.length, 1);
  const fresh = createPrototypeClient();
  assert.deepEqual(fresh.getSnapshot().tasks, []);
  assert.deepEqual(fresh.getSnapshot().sessions, []);
});

test('invalid submissions do not mutate existing state', () => {
  const client = createPrototypeClient();
  const session = client.createSession();
  const before = client.getSnapshot();
  assert.throws(() => client.sendMessage(session.id, '  ', []), /请输入/);
  assert.throws(() => client.createTask({ name: ' ', kind: 'api', target: '' }), /请输入/);
  assert.throws(() => client.createTask({ name: '任务', kind: 'unknown', target: '' }), /未知/);
  assert.equal(client.getSnapshot(), before);
});

test('subscribers receive fresh snapshots and can detach on navigation', () => {
  const client = createPrototypeClient();
  const before = client.getSnapshot();
  let notifications = 0;
  const unsubscribe = client.subscribe(() => {
    notifications += 1;
  });
  client.createSession();
  assert.equal(notifications, 1);
  assert.notEqual(client.getSnapshot(), before);
  assert.deepEqual(before.sessions, []);
  unsubscribe();
  client.createSession();
  assert.equal(notifications, 1);
});
