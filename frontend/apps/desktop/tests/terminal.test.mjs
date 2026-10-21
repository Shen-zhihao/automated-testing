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

test('manual commands need exact approval and cannot be replayed, edited or approved from another project', async (t) => {
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
  assert.equal(run.status, 'pending');
  assert.equal(executed, 0);
  assert.throws(() => terminal.start(b, run.id), /不属于/);
  terminal.start(a, run.id, true);
  await terminal.running.get(a).done;
  assert.equal(executed, 1);
  assert.equal(terminal.get(a, run.id).status, 'passed');
  assert.match(terminal.get(a, run.id).output, /成功/);
  assert.throws(() => terminal.start(a, run.id, true), /待确认/);
  assert.equal(terminal.list(b).length, 0);
  assert.equal('fingerprint' in terminal.list(a)[0], false);
});

test('managed mode executes new reviewed commands, preserves old pending commands, and enforces local and model denials', async (t) => {
  let executed = 0;
  const { a, terminal, workspace } = await setup(t, {
    execute: () => {
      executed++;
      return { done: Promise.resolve({ code: 0 }), stop() {} };
    },
  });
  const pending = await terminal.propose(a, { command: 'pwd', reason: '确认测试工程工作目录' });
  terminal.setMode(a, 'managed');
  assert.equal(terminal.get(a, pending.id).status, 'pending');
  assert.equal(executed, 0);
  const run = await terminal.propose(a, { command: 'echo 测试', reason: '检查工程命令执行能力' });
  await terminal.running.get(a)?.done;
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

test('approval rechecks scripts, prevents symlink escape and rejects changed files', async (t) => {
  let executed = 0;
  const { a, terminal, root } = await setup(t, {
    execute: () => {
      executed++;
      return { done: Promise.resolve({ code: 0 }), stop() {} };
    },
  });
  const directory = await terminal.ensureDirectory(a);
  await writeFile(path.join(directory, 'test.mjs'), 'console.log("old")');
  const pending = await terminal.propose(a, {
    command: 'node test.mjs',
    reason: '运行计数验收测试',
  });
  assert.equal(pending.status, 'pending');
  await writeFile(path.join(directory, 'test.mjs'), 'console.log("changed")');
  terminal.start(a, pending.id, true);
  await terminal.running.get(a).done;
  assert.equal(executed, 0);
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
  terminal.start(a, pending.id);
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
  terminal.start(a, run.id);
  await terminal.running.get(a).done;
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

test('managed commands queue per project; stopping leaves the remaining queue for manual review', async (t) => {
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
  terminal.setMode(a, 'managed');
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
  assert.equal(terminal.get(a, third.id).status, 'pending');
  assert.equal(controls.length, 2);
});
