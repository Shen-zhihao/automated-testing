import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStore } from '../src/store.mjs';
import { WorkspaceService } from '../src/workspace.mjs';
import { TerminalService } from '../src/terminal/service.mjs';
import {
  commandTokens,
  inspectCommand,
  defaultShell,
  shellInvocation,
  commandEnvironment,
} from '../src/terminal/policy.mjs';
import { executeCommand } from '../src/terminal/runner.mjs';
import { DEFAULT_MODEL } from '../src/settings.mjs';
const reply = (content) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-terminal-'));
  const store = new WorkspaceStore(':memory:');
  const workspace = new WorkspaceService({
    store,
    settings: { modelConfig: async () => ({ ...DEFAULT_MODEL, model: 'fixture' }) },
    fetchImpl: async () => reply('{"decision":"allow"}'),
  });
  const terminal = new TerminalService(workspace, { root, ...options });
  workspace.terminal = terminal;
  const a = store.projects.create({ name: '计数测试' }).id,
    b = store.projects.create({ name: '其他工程' }).id;
  t.after(async () => {
    await terminal.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, workspace, terminal, a, b };
}

test('reviewed commands execute silently and cannot be replayed or accessed from another project', async (t) => {
  let executed = 0;
  const { a, b, terminal } = await setup(t, {
    execute: ({ tokens, onOutput }) => {
      executed++;
      onOutput('计数测试成功');
      assert.deepEqual(tokens, ['echo', '工程测试']);
      return { done: Promise.resolve({ code: 0 }), stop() {} };
    },
  });
  const run = await terminal.propose(a, { command: 'echo 工程测试', reason: '检查本工程测试输出' });
  assert.throws(() => terminal.start(b, run.id), /不属于/);
  const result = await terminal.wait(a, run.id);
  assert.equal(executed, 1);
  assert.equal(terminal.get(a, run.id).status, 'passed');
  assert.match(terminal.get(a, run.id).output, /成功/);
  assert.equal(result.execution, 'background');
  assert.throws(() => terminal.start(a, run.id), /排队/);
  assert.equal(terminal.list(b).length, 0);
  assert.equal('fingerprint' in terminal.list(a)[0], false);
});

test('background execution ignores obsolete permission settings while retaining local and model denials', async (t) => {
  let executed = 0;
  const { a, terminal, workspace, store } = await setup(t, {
    execute: () => {
      executed++;
      return { done: Promise.resolve({ code: 0 }), stop() {} };
    },
  });
  store.db.prepare('INSERT INTO command_settings VALUES (?, ?)').run(a, 'manual');
  assert.equal(terminal.info(a).execution, 'background');
  const run = await terminal.propose(a, { command: 'echo 测试', reason: '检查工程命令执行能力' });
  await terminal.wait(a, run.id);
  assert.equal(terminal.get(a, run.id).status, 'passed');
  assert.equal(executed, 1);
  for (const command of [
    'sudo rm -rf /',
    'node -e "process.exit(0)"',
    'echo ok; rm test',
    'cat ../private',
    'cat ~/.ssh/id_rsa',
    'git push',
  ]) {
    assert.equal((await terminal.propose(a, { command, reason: '尝试绕过' })).status, 'blocked');
  }
  workspace.fetchImpl = async () => reply('{"decision":"unsafe"}');
  assert.equal(
    (await terminal.propose(a, { command: 'echo 测试', reason: '没有足够授权' })).status,
    'blocked',
  );
  workspace.fetchImpl = async () => reply('not-json');
  assert.equal(
    (await terminal.propose(a, { command: 'pwd', reason: '检查目录' })).status,
    'blocked',
  );
  assert.equal(executed, 1);
});

test('queued commands recheck scripts and prevent changed files or symlink escape', async (t) => {
  let executed = 0;
  let finish;
  const started = Promise.withResolvers();
  const { a, terminal, root } = await setup(t, {
    execute: () => {
      executed++;
      started.resolve();
      return {
        done: new Promise((resolve) => {
          finish = resolve;
        }),
        stop: () => finish({ code: null, cancelled: true }),
      };
    },
  });
  const directory = await terminal.ensureDirectory(a);
  await writeFile(path.join(directory, 'test.mjs'), 'console.log("old")');
  const first = await terminal.propose(a, { command: 'echo hold', reason: '检查本工程执行队列' });
  await started.promise;
  const pending = await terminal.propose(a, {
    command: 'node test.mjs',
    reason: '运行计数验收测试',
  });
  assert.equal(pending.status, 'pending');
  await writeFile(path.join(directory, 'test.mjs'), 'console.log("changed")');
  finish({ code: 0 });
  await terminal.wait(a, first.id);
  await terminal.wait(a, pending.id);
  assert.equal(executed, 1);
  assert.match(terminal.get(a, pending.id).error, /变化/);
  const outside = path.join(root, 'private.txt');
  await writeFile(outside, 'external');
  await symlink(outside, path.join(directory, 'linked.txt'));
  await assert.rejects(inspectCommand('cat linked.txt', directory), /符号链接/);
});

test('running commands block cleanup, cancellation records state and project deletion clears managed files and history', async (t) => {
  let finish, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const { a, terminal, workspace, store } = await setup(t, {
    execute: () => {
      started();
      return {
        done: new Promise((resolve) => {
          finish = resolve;
        }),
        stop: () => finish({ code: null, cancelled: true }),
      };
    },
  });
  const directory = await terminal.ensureDirectory(a);
  await writeFile(path.join(directory, 'generated.md'), '测试报告');
  const pending = await terminal.propose(a, { command: 'echo 测试', reason: '测试工程运行状态' });
  await ready;
  await assert.rejects(workspace.projectFiles.remove(a, '计数测试'), /等待/);
  const done = terminal.running.get(a).done;
  terminal.stop(a);
  await done;
  assert.equal(terminal.get(a, pending.id).status, 'cancelled');
  await workspace.projectFiles.remove(a, '计数测试');
  await assert.rejects(access(directory));
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM command_runs WHERE project_id=?').get(a).n,
    0,
  );
});

test('command output is bounded and list payloads do not duplicate large logs', async (t) => {
  const { a, terminal } = await setup(t, {
    execute: ({ onOutput }) => {
      onOutput('字'.repeat(200000));
      return { done: Promise.resolve({ code: 0 }), stop() {} };
    },
  });
  const run = await terminal.propose(a, { command: 'echo 测试', reason: '验收日志输出边界' });
  await terminal.wait(a, run.id);
  assert.equal(terminal.get(a, run.id).output.length, 128 * 1024);
  assert.equal(terminal.get(a, run.id).truncated, true);
  assert.equal(terminal.list(a)[0].output.length, 500);
});

test('system Shell executes a real command, captures output, exit failure and enforces timeout', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shell-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const shell = defaultShell(),
    output = [];
  const run = executeCommand({
    shell,
    tokens: ['echo', '工程测试'],
    cwd: root,
    onOutput: (chunk) => output.push(chunk),
  });
  assert.equal((await run.done).code, 0);
  assert.match(output.join(''), /工程测试/);
  await writeFile(
    path.join(root, 'fail.mjs'),
    'console.log("expected failure"); process.exitCode=3;',
  );
  const failed = executeCommand({
    shell,
    tokens: ['node', 'fail.mjs'],
    cwd: root,
    onOutput: () => {},
  });
  assert.equal((await failed.done).code, 3);
  await writeFile(path.join(root, 'slow.mjs'), 'setTimeout(() => {}, 30000);');
  const timed = executeCommand({
    shell,
    tokens: ['node', 'slow.mjs'],
    cwd: root,
    onOutput: () => {},
    timeoutMs: 100,
  });
  assert.equal((await timed.done).timedOut, true);
});

test('Windows uses ComSpec without autorun; command environments exclude inherited credentials', () => {
  const shell = defaultShell('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
  assert.deepEqual(shellInvocation(shell, ['echo', 'hello world'], 'win32'), {
    file: shell,
    args: ['/d', '/s', '/c', 'echo "hello world"'],
  });
  assert.equal(
    commandEnvironment({ PATH: '/bin', OPENAI_API_KEY: 'private', SECRET_TOKEN: 'hidden' })
      .OPENAI_API_KEY,
    undefined,
  );
  assert.deepEqual(commandTokens('node "tests/计数 验收.mjs"'), ['node', 'tests/计数 验收.mjs']);
});

test('background commands queue per project and stopping cancels the remaining queue', async (t) => {
  const controls = [];
  const started = [Promise.withResolvers(), Promise.withResolvers()];
  const { a, terminal } = await setup(t, {
    execute: ({ tokens }) => {
      let finish;
      const done = new Promise((resolve) => {
        finish = resolve;
      });
      controls.push({ tokens, finish });
      started[controls.length - 1]?.resolve();
      return { done, stop: () => finish({ code: null, cancelled: true }) };
    },
  });
  const first = await terminal.propose(a, { command: 'echo one', reason: '工程验收第一步' });
  const second = await terminal.propose(a, { command: 'echo two', reason: '工程验收第二步' });
  assert.equal(terminal.get(a, first.id).status, 'running');
  assert.equal(terminal.get(a, second.id).status, 'pending');
  await started[0].promise;
  const firstDone = terminal.running.get(a).done;
  controls[0].finish({ code: 0 });
  await firstDone;
  await started[1].promise;
  assert.equal(terminal.get(a, second.id).status, 'running');
  const third = await terminal.propose(a, { command: 'echo three', reason: '工程验收第三步' });
  const secondDone = terminal.running.get(a).done;
  terminal.stop(a);
  await secondDone;
  assert.equal(terminal.get(a, second.id).status, 'cancelled');
  assert.equal(terminal.get(a, third.id).status, 'cancelled');
  assert.equal(controls.length, 2);
});

test('aborting a chat wait stops the process and removes its result listener', async (t) => {
  const started = Promise.withResolvers();
  let finish;
  const { a, terminal } = await setup(t, {
    execute: () => {
      started.resolve();
      return {
        done: new Promise((resolve) => {
          finish = resolve;
        }),
        stop: () => finish({ code: null, cancelled: true }),
      };
    },
  });
  const run = await terminal.propose(a, { command: 'echo testing', reason: '检查工程执行取消' });
  await started.promise;
  const done = terminal.running.get(a).done;
  const controller = new AbortController();
  const waiting = terminal.wait(a, run.id, controller.signal);
  controller.abort();
  await assert.rejects(waiting, /abort/i);
  await done;
  assert.equal(terminal.get(a, run.id).status, 'cancelled');
  assert.equal(terminal.changes.listenerCount(run.id), 0);
});

test('closing waits for cancelled command reviews to finish saving their final state', async (t) => {
  const { a, terminal, workspace } = await setup(t);
  const reviewing = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  let release;
  workspace.fetchImpl = async (_, options) => {
    reviewing.resolve();
    return new Promise((_, reject) => {
      options.signal.addEventListener(
        'abort',
        () => {
          release = () => reject(new Error('cancelled'));
          cancelled.resolve();
        },
        { once: true },
      );
    });
  };
  const proposed = terminal.propose(a, { command: 'pwd', reason: '检查工程关闭时的审查状态' });
  await reviewing.promise;
  let closed = false;
  const closing = terminal.close().then(() => {
    closed = true;
  });
  await cancelled.promise;
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    assert.equal(terminal.reviews.size, 1);
    await assert.rejects(
      terminal.propose(a, { command: 'pwd', reason: '关闭后不再创建命令' }),
      /关闭/,
    );
  } finally {
    release();
    await Promise.allSettled([proposed, closing]);
  }
  assert.equal((await proposed).status, 'cancelled');
  assert.equal(terminal.reviews.size, 0);
  assert.equal(closed, true);
});

test('startup retains old pending records as interrupted instead of silently resuming them', async (t) => {
  let executed = 0;
  const { a, terminal, workspace, root } = await setup(t);
  terminal.save({
    id: 'legacy-pending',
    projectId: a,
    createdAt: '2026-10-21',
    status: 'pending',
    autoApproved: true,
    command: 'pwd',
    output: '',
  });
  const reopened = new TerminalService(workspace, {
    root,
    execute: () => {
      executed++;
      throw new Error('must not resume');
    },
  });
  reopened.drain();
  assert.equal(reopened.get(a, 'legacy-pending').status, 'interrupted');
  assert.equal(executed, 0);
  await reopened.close();
});
