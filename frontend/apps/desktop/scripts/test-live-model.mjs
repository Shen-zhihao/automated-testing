// 显式运行才调用已配置的真实模型；不参与 pnpm test，不输出或复制模型凭据。
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argument = (name) => args[args.indexOf(name) + 1];
const profile = argument('--profile');
const recheck = args.includes('--recheck-generation')
  ? path.resolve(argument('--recheck-generation'))
  : null;
if (!args.includes('--profile') || !['development', 'production'].includes(profile))
  throw new Error('用法：pnpm test:live --profile development|production');

if (!process.versions.electron) {
  const { default: electron } = await import('electron');
  const { spawn } = await import('node:child_process');
  const { prepareRuntime } = await import('./runtime.mjs');
  const appRoot = fileURLToPath(new URL('../', import.meta.url));
  const executable = await prepareRuntime(electron, appRoot);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xuzhou-live-model-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executable,
    [
      fileURLToPath(import.meta.url),
      '--profile',
      profile,
      '--output',
      directory,
      ...(recheck ? ['--recheck-generation', recheck] : []),
    ],
    {
      env,
      stdio: 'inherit',
    },
  );
  child.on('error', () => {
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} else {
  // Electron 等入口模块加载结束才发出 ready；这里不能在模块顶层等待 whenReady。
  runLive().catch((error) => {
    console.error(`联调启动失败：${error.message}`);
    process.exit(1);
  });
}

async function runLive() {
  const { app, safeStorage } = await import('electron');
  const directory = argument('--output');
  const userData = path.join(
    app.getPath('appData'),
    profile === 'development' ? 'Test Agent Development' : 'Test Agent',
  );
  app.setName('Test Agent');
  app.setPath('userData', path.join(directory, 'runtime'));
  app.setPath('sessionData', path.join(directory, 'runtime'));
  console.log(JSON.stringify({ event: 'runtime-start', profile, directory }));
  await app.whenReady();
  app.dock?.hide();
  let store;
  let workspace;
  let terminal;
  let config;
  let watchdog;
  let stage = 'setup';
  const report = {
    profile,
    mode: recheck ? 'recheck-generation' : 'full',
    startedAt: new Date().toISOString(),
    stages: [],
    calls: [],
  };
  const safe = (value) =>
    config?.apiKey ? String(value).split(config.apiKey).join('[已隐藏]') : String(value);
  const save = () =>
    writeFile(path.join(directory, 'result.json'), safe(JSON.stringify(report, null, 2)), {
      mode: 0o600,
    });
  const event = (data) => console.log(safe(JSON.stringify(data)));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { WorkspaceStore } = await import('../src/store.mjs');
    const { SettingsService } = await import('../src/settings.mjs');
    const { WorkspaceService } = await import('../src/workspace.mjs');
    const { TestingService } = await import('../src/testing/service.mjs');
    const { TerminalService } = await import('../src/terminal/service.mjs');
    const { parseInWorker } = await import('../src/documents/import.mjs');
    let storageDirectory = path.join(userData, 'storage');
    try {
      const pointer = JSON.parse(
        await readFile(path.join(userData, 'storage-location.json'), 'utf8'),
      );
      if (pointer.version !== 1 || !path.isAbsolute(pointer.directory))
        throw new Error('保存目录指针无效。');
      storageDirectory = pointer.directory;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const original = new DatabaseSync(path.join(storageDirectory, 'test-agent.sqlite'), {
      readOnly: true,
    });
    let saved;
    try {
      const row = original.prepare('SELECT value FROM settings WHERE key = ?').get('workspace');
      if (!row) throw new Error('当前环境尚未配置模型。');
      saved = JSON.parse(row.value);
    } finally {
      original.close();
    }
    const settings = new SettingsService(
      { readSettings: () => saved },
      {
        decrypt: async (buffer) => (await safeStorage.decryptStringAsync(buffer)).result,
      },
    );
    config = await settings.modelConfig();
    report.model = {
      name: config.model,
      host: new URL(config.baseUrl).host,
      format: config.format,
      maxTokens: config.maxTokens,
      timeoutSeconds: config.timeoutSeconds,
    };
    event({ event: 'start', directory, ...report.model });
    const fetchImpl = async (url, options) => {
      const started = Date.now();
      const body = JSON.parse(options.body);
      const entry = {
        stage,
        index: report.calls.length + 1,
        status: 'running',
        thinking: body.thinking?.type ?? 'default',
      };
      report.calls.push(entry);
      try {
        const response = await fetch(url, options);
        const data = await response.clone().json();
        Object.assign(entry, {
          status: response.status,
          milliseconds: Date.now() - started,
          finishReason: data.choices?.[0]?.finish_reason ?? data.status,
          textCharacters:
            data.choices?.[0]?.message?.content?.length ??
            data.output
              ?.flatMap((item) => item.content ?? [])
              .reduce((sum, part) => sum + (part.text?.length ?? 0), 0),
          usage: data.usage,
        });
        event({ event: 'model-call', ...entry });
        return response;
      } catch (error) {
        Object.assign(entry, {
          status: 'error',
          milliseconds: Date.now() - started,
          error: safe(error.message),
        });
        throw error;
      }
    };
    store = new WorkspaceStore(path.join(directory, 'test-agent.sqlite'));
    let lastProgress;
    const notify = () => {
      const messages = [
        ...(workspace?.jobs.values() ?? []),
        ...(workspace?.testing?.jobs.values() ?? []),
      ]
        .filter((job) => job.status === 'running')
        .map((job) => job.message)
        .join('；');
      if (messages && messages !== lastProgress)
        event({ event: 'progress', stage, message: messages });
      lastProgress = messages;
    };
    const testing = new TestingService({ store, settings, fetchImpl, notify });
    workspace = new WorkspaceService({
      store,
      settings,
      testing,
      fetchImpl,
      parseFile: parseInWorker,
      notify,
    });
    terminal = new TerminalService(workspace, { root: path.join(directory, 'projects') });
    workspace.terminal = testing.terminal = terminal;
    const project = store.projects.create({
      name: '计数器真实模型联调',
      description: '隔离样例：验证需求分析、测试设计和本机 Node 测试执行。',
    });
    const working = await terminal.ensureDirectory(project.id);
    await writeFile(
      path.join(working, 'counter.mjs'),
      `export function increment(value, fail = false) {
  if (fail) return { value, error: '操作失败，请重试' };
  return { value: Math.min(value + 1, 3), error: '' };
}
`,
    );
    await writeFile(
      path.join(working, 'counter.test.mjs'),
      `import test from 'node:test';
import assert from 'node:assert/strict';
import { increment } from './counter.mjs';
test('计数从0增加到1', () => assert.equal(increment(0).value, 1));
test('计数上限为3', () => assert.equal(increment(3).value, 3));
test('失败保留原值并提示重试', () => assert.deepEqual(increment(1, true), { value: 1, error: '操作失败，请重试' }));
`,
    );
    await writeFile(
      path.join(working, 'failure.test.mjs'),
      `import test from 'node:test';
import assert from 'node:assert/strict';
test('故意失败的验收记录样例', () => assert.equal(1, 2));
`,
    );
    const requirementFile = path.join(directory, 'counter-requirements.md');
    await writeFile(
      requirementFile,
      `# 计数器需求
本工程只有一个计数功能，用于演示本机验收。
- 初始显示“计数：0”。点击“增加”成功后计数加1，最大值为3。
- 达到3时“增加”按钮禁用，计数保持3。
- 增加失败时计数保持原值，显示“操作失败，请重试”；重试成功后清除错误提示。
- 不包含登录、付费、外部网络或数据持久化。
工程内已有 counter.mjs 与 counter.test.mjs，可以用 Node 内置测试验证计数逻辑；界面显示和按钮状态需另外验收。
`,
    );
    async function phase(name, operation) {
      stage = name;
      const started = Date.now();
      event({ event: 'stage-start', stage });
      try {
        const details = await operation();
        report.stages.push({
          name,
          status: 'passed',
          milliseconds: Date.now() - started,
          ...details,
        });
        event({ event: 'stage-passed', stage, milliseconds: Date.now() - started, ...details });
        await save();
        return true;
      } catch (error) {
        const failure = {
          name,
          status: 'failed',
          milliseconds: Date.now() - started,
          error: safe(error.message),
        };
        report.stages.push(failure);
        event({ event: 'stage-failed', ...failure });
        await save();
        return false;
      }
    }
    watchdog = setTimeout(() => workspace.cancelAll(), 15 * 60_000);
    await phase('connection', async () => ({ message: await workspace.testModel() }));
    let documentId;
    const analyzed = await phase(recheck ? 'reuse-analysis' : 'analysis', async () => {
      const imported = await workspace.importFiles([requirementFile], project.id);
      assert.deepEqual(imported.errors, []);
      documentId = imported.imported[0];
      if (recheck) {
        const previous = JSON.parse(await readFile(path.join(recheck, 'result.json'), 'utf8'));
        assert.ok(
          previous.stages.some((item) => item.name === 'analysis' && item.status === 'passed'),
        );
        assert.equal(
          await readFile(path.join(recheck, 'counter-requirements.md'), 'utf8'),
          await readFile(requirementFile, 'utf8'),
          '复测必须使用同一份需求夹具',
        );
        store.saveAnalysis(documentId, {
          content: await readFile(path.join(recheck, 'analysis.md'), 'utf8'),
          createdAt: previous.finishedAt,
          model: previous.model.name,
        });
        return { documentId, reusedFrom: recheck };
      }
      const result = await workspace.analyze(
        documentId,
        '只分析这一个计数功能，保留上限3、失败不改变计数和重试清除错误的规则，输出可验证的实现步骤与验收标准。',
      );
      assert.match(result.content, /S-\d+-\d+/);
      assert.match(result.content, /AC-\d+-\d+/);
      assert.match(result.content, /3/);
      assert.match(result.content, /失败/);
      assert.match(result.content, /待验收/);
      await writeFile(path.join(directory, 'analysis.md'), safe(result.content));
      return { documentId, characters: result.content.length };
    });
    const session = testing.createSession({
      projectId: project.id,
      ...(documentId ? { documentId } : {}),
    });
    if (!recheck)
      await phase('chat', async () => {
        const value = await testing.sendMessage(
          session.id,
          '请根据当前计数器需求，简要说明如何验收上限3，以及失败后重试。只给验收建议，本轮不要执行命令。',
          documentId ? [documentId] : [],
        );
        const answer = value.messages.at(-1);
        assert.equal(answer.status, 'complete');
        assert.equal(Boolean(answer.refused), false);
        assert.match(answer.content, /3/);
        assert.equal(answer.commandIds.length, 0);
        await writeFile(path.join(directory, 'chat.md'), safe(answer.content));
        return {
          sessionId: session.id,
          characters: answer.content.length,
          excerpts: answer.excerpts.length,
        };
      });
    if (analyzed)
      await phase('test-generation', async () => {
        const task = testing.createTask({
          documentId,
          projectId: project.id,
          name: '计数器验收',
          scope:
            '验证计数初值、增加到上限3、失败保留原值和重试恢复；区分Node逻辑测试与界面人工验收。',
        });
        const result = await testing.generateDocument(task.id);
        assert.ok(result.report.cases.length >= 3);
        assert.ok(
          result.report.cases.every(
            (item) => item.requirement && item.steps.length && item.expected.length,
          ),
        );
        assert.equal(result.runs.length, 0);
        await writeFile(path.join(directory, 'test-document.md'), safe(result.report.markdown));
        return {
          taskId: task.id,
          cases: result.report.cases.length,
          characters: result.report.markdown.length,
        };
      });
    for (const [name, file, expected] of recheck
      ? []
      : [
          ['command-success', 'counter.test.mjs', 'passed'],
          ['command-failure', 'failure.test.mjs', 'failed'],
        ]) {
      await phase(name, async () => {
        const chat = testing.createSession({
          projectId: project.id,
          ...(documentId ? { documentId } : {}),
        });
        const request =
          name === 'command-success'
            ? `请实际执行本工程已有的 Node 测试，准确运行单条命令 node --test ${file}，完成后依据真实输出汇报通过和失败数量。不要生成脚本或修改文件。`
            : `请运行本工程已有的失败记录验收样例，准确执行 node --test ${file}。这个样例故意失败，用于检查失败退出码和输出是否被正确记录；不要修改或修复该样例，不要把失败说成通过。`;
        const result = await testing.sendMessage(chat.id, request, documentId ? [documentId] : []);
        const answer = result.messages.at(-1);
        assert.equal(answer.status, 'complete');
        assert.equal(Boolean(answer.refused), false);
        const commands = answer.commandIds.map((id) => terminal.get(project.id, id));
        assert.equal(commands.length, 1, '模型必须实际提交且只提交指定的单条命令');
        assert.equal(commands[0].command, `node --test ${file}`);
        assert.equal(commands[0].status, expected);
        if (expected === 'passed') assert.equal(commands[0].exitCode, 0);
        else assert.notEqual(commands[0].exitCode, 0);
        assert.match(
          commands[0].output,
          expected === 'passed' ? /pass 3|tests 3/ : /fail 1|not ok/,
        );
        await writeFile(path.join(directory, `${name}.md`), safe(answer.content));
        return {
          commandStatus: commands[0].status,
          exitCode: commands[0].exitCode,
          command: commands[0].command,
          output: commands[0].output,
          answer: answer.content,
        };
      });
    }
    report.finishedAt = new Date().toISOString();
    report.passed =
      report.stages.length === (recheck ? 3 : 6) &&
      report.stages.every((item) => item.status === 'passed');
    await save();
    event({ event: 'finished', passed: report.passed, directory, calls: report.calls.length });
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    report.stages.push({ name: stage, status: 'failed', error: safe(error.message) });
    await save();
    event({ event: 'fatal', stage, error: safe(error.message), directory });
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    workspace?.cancelAll();
    await terminal?.close();
    store?.close();
    config = undefined;
    app.exit(process.exitCode ?? 0);
  }
}
