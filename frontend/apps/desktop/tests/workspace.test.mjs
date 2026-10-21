import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStore } from '../src/store.mjs';
import { SettingsService, DEFAULT_MODEL, normalizeBaseUrl } from '../src/settings.mjs';
import { WorkspaceService } from '../src/workspace.mjs';
import { complete, analyzeDocument, splitText } from '../src/model.mjs';
import { createServer } from 'node:http';
import { reportFixture } from './report-fixture.mjs';

const vault = {
  encrypt: async (text) => Buffer.from(text.split('').reverse().join('')),
  decrypt: async (value) => value.toString().split('').reverse().join(''),
};
const config = {
  ...DEFAULT_MODEL,
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: '',
};
const answer = (text) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
  );
const source = {
  name: '需求',
  source: '/sample.md',
  kind: 'md',
  content: '密码错误 5 次后锁定。',
  warnings: [],
};

test('SQLite persists documents and reports; secrets are redacted, preserved, cleared and bound to endpoint', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'storage', 'workspace.sqlite');
  let store = new WorkspaceStore(file);
  let settings = new SettingsService(store, vault);
  await settings.save({ model: config, apiKey: 'test-only-key', clearApiKey: false });
  assert.equal(settings.public().hasApiKey, true);
  assert.ok(!JSON.stringify(settings.public()).includes('test-only-key'));
  const document = store.addDocument(source);
  store.saveAnalysis(document.id, { content: '测试密码锁定', model: 'test-model' });
  store.close();
  assert.ok(!(await readFile(file)).includes(Buffer.from('test-only-key')));
  store = new WorkspaceStore(file);
  settings = new SettingsService(store, vault);
  assert.equal(store.getDocument(document.id).analysis.content, '测试密码锁定');
  await settings.save({ model: config, apiKey: '', clearApiKey: false });
  assert.equal((await settings.modelConfig()).apiKey, 'test-only-key');
  await settings.save({
    model: { ...config, baseUrl: 'https://other.example/v1' },
    apiKey: '',
    clearApiKey: false,
  });
  assert.equal(settings.public().hasApiKey, false);
  await settings.save({ model: config, apiKey: 'again', clearApiKey: false });
  await settings.save({ model: config, apiKey: '', clearApiKey: true });
  assert.equal((await settings.modelConfig()).apiKey, '');
  store.deleteDocument(document.id);
  assert.equal(store.listDocuments().length, 0);
  store.close();
});

test('invalid configuration or unavailable vault never overwrites existing settings', async () => {
  const store = new WorkspaceStore(':memory:');
  const settings = new SettingsService(store, vault);
  await settings.save({ model: config, apiKey: '', clearApiKey: false });
  await assert.rejects(settings.save({ model: { ...config, maxTokens: 0 } }), /Token/);
  settings.vault = {
    encrypt: async () => {
      throw new Error('vault locked');
    },
  };
  await assert.rejects(
    settings.save({ model: { ...config, model: 'other' }, apiKey: 'new-key' }),
    /vault locked/,
  );
  assert.equal(settings.public().model.model, 'test-model');
  for (const url of [
    'http://remote.example/v1',
    'https://key:secret@example.com',
    'https://example.com/v1?key=x',
    'file:///tmp/model',
  ])
    assert.throws(() => normalizeBaseUrl(url));
  assert.equal(
    normalizeBaseUrl('http://localhost:11434/v1/chat/completions'),
    'http://localhost:11434/v1',
  );
  store.close();
});

test('model request actually reaches a loopback endpoint with bounded parameters and reads both API formats', async (t) => {
  const received = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url.endsWith('responses')
          ? {
              status: 'completed',
              output: [{ content: [{ type: 'output_text', text: 'Responses reply' }] }],
            }
          : { choices: [{ message: { content: 'Chat reply' }, finish_reason: 'stop' }] },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  assert.equal(
    await complete({ ...config, baseUrl, apiKey: 'fixture-key' }, [
      { role: 'user', content: 'hello' },
    ]),
    'Chat reply',
  );
  assert.equal(
    await complete({ ...config, baseUrl, format: 'responses' }, [
      { role: 'user', content: 'hello' },
    ]),
    'Responses reply',
  );
  assert.equal(received[0].headers.authorization, 'Bearer fixture-key');
  assert.equal(received[0].body.max_tokens, 4096);
  assert.equal(received[0].body.temperature, undefined);
  assert.equal(received[1].body.store, false);
});

test('model failures, refusal and truncated responses never look successful', async () => {
  const messages = [{ role: 'user', content: 'test' }];
  await assert.rejects(
    complete(config, messages, { fetchImpl: async () => new Response('', { status: 401 }) }),
    /API Key/,
  );
  await assert.rejects(
    complete(config, messages, { fetchImpl: async () => new Response('<html>bad</html>') }),
    /非 JSON/,
  );
  await assert.rejects(
    complete(config, messages, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
          }),
        ),
    }),
    /截断/,
  );
  await assert.rejects(
    complete(config, messages, { fetchImpl: async () => answer('') }),
    /没有返回/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    complete(config, messages, {
      signal: abort.signal,
      fetchImpl: async (_, opts) => {
        opts.signal.throwIfAborted();
      },
    }),
    /取消/,
  );
});

test('long document analysis covers every segment and reports progress before final synthesis', async () => {
  const content =
    '第一段规则\n' +
    '甲'.repeat(12000) +
    '\n' +
    '第二段边界\n' +
    '乙'.repeat(12000) +
    '\n尾部独有需求';
  assert.equal(splitText(content).join(''), content);
  const calls = [],
    progress = [];
  const analysis = await analyzeDocument({ ...source, content }, '边界条件', config, {
    onProgress: (value) => progress.push(value),
    fetchImpl: async (_, request) => {
      const body = JSON.parse(request.body);
      if (body.messages[0]?.content.includes('独立的工程范围与安全审查器'))
        return answer('{"decision":"allow"}');
      calls.push(body);
      return answer(calls.length <= 3 ? '分段笔记：锁定条件' : reportFixture);
    },
  });
  assert.equal(analysis.segments, 3);
  assert.ok(calls.some((call) => call.messages[1].content.includes('尾部独有需求')));
  assert.equal(calls.length, 4);
  assert.match(calls[3].messages[1].content, /分段分析笔记/);
  assert.equal(analysis.kind, 'implementation-plan');
  assert.ok(analysis.content.includes(reportFixture.trim()));
  assert.equal(progress.at(-1), '正在编写功能实现步骤与验收标准');
});

test('mixed import keeps valid files; cancellation preserves previous analysis and allows retry', async () => {
  const store = new WorkspaceStore(':memory:');
  const settings = new SettingsService(store, vault);
  await settings.save({ model: config, apiKey: '', clearApiKey: false });
  const service = new WorkspaceService({
    store,
    settings,
    feishu: { status: () => ({ connected: false }) },
    parseFile: async (file) => {
      if (file.endsWith('.bad')) throw new Error('bad file');
      return source;
    },
    fetchImpl: async (_, options) => {
      await new Promise((_, reject) => {
        if (options.signal.aborted) reject(new Error('aborted'));
        else
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
      });
    },
  });
  const imported = await service.importFiles(['/good.md', '/invalid.bad']);
  assert.equal(imported.imported.length, 1);
  assert.equal(imported.errors.length, 1);
  const id = imported.imported[0];
  store.saveAnalysis(id, { content: 'previous report' });
  const running = service.analyze(id, '');
  service.cancel(id);
  await assert.rejects(running, /取消/);
  assert.equal(store.getDocument(id).analysis.content, 'previous report');
  assert.equal(service.snapshot().jobs[id].status, 'cancelled');
  service.fetchImpl = async (_, options) =>
    answer(
      JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
        ? '{"decision":"allow"}'
        : '## 功能实现步骤\n仅包含步骤，缺少验收。',
    );
  await assert.rejects(service.analyze(id, ''), /功能验收标准/);
  assert.equal(store.getDocument(id).analysis.content, 'previous report');
  service.fetchImpl = async (_, options) =>
    answer(
      JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
        ? '{"decision":"allow"}'
        : reportFixture,
    );
  await service.analyze(id, '');
  assert.equal(store.getDocument(id).analysis.kind, 'implementation-plan');
  assert.ok(store.getDocument(id).analysis.content.includes(reportFixture.trim()));
  store.close();
});

test('larger output settings reach the model unchanged and no longer hit the old character cap', async () => {
  const store = new WorkspaceStore(':memory:');
  const settings = new SettingsService(store, vault);
  try {
    await settings.save({
      model: { ...config, maxTokens: 393216 },
      apiKey: '',
      clearApiKey: false,
    });
    const result = await complete(
      await settings.modelConfig(),
      [{ role: 'user', content: 'fixture' }],
      {
        fetchImpl: async (_, request) => {
          assert.equal(JSON.parse(request.body).max_tokens, 393216);
          return answer('结论'.repeat(60000));
        },
      },
    );
    assert.equal(result.length, 120000);
    await assert.rejects(settings.save({ model: { ...config, maxTokens: 1048576 } }), /输出上限/);
  } finally {
    store.close();
  }
});

test('source refresh failure keeps the document and blocks analysis of stale text while refreshing', async () => {
  const store = new WorkspaceStore(':memory:');
  const settings = new SettingsService(store, vault);
  const doc = store.addDocument(source);
  store.saveAnalysis(doc.id, { content: '已有结果' });
  let rejectRead;
  const service = new WorkspaceService({
    store,
    settings,
    feishu: { status: () => ({}) },
    parseFile: () =>
      new Promise((_, reject) => {
        rejectRead = reject;
      }),
  });
  const refresh = service.refreshDocument(doc.id);
  await assert.rejects(service.analyze(doc.id, ''), /重新提取/);
  assert.throws(() => service.remove(doc.id), /重新提取/);
  rejectRead(new Error('source-missing'));
  await assert.rejects(refresh, /source-missing/);
  assert.equal(store.getDocument(doc.id).analysis.content, '已有结果');
  assert.equal(service.importing, false);
  store.close();
});

test('long HTML analysis carries interaction and error evidence through chunk reading to the testing report request', async () => {
  const calls = [];
  const html = {
    ...source,
    kind: 'html',
    name: 'prototype.html',
    content: '流程入口\n' + '页面状态\n'.repeat(2600) + '\n末尾规则：失败只重试本段',
  };
  const chunks = splitText(html.content);
  const htmlReport =
    reportFixture +
    ['端到端业务流程', '关键交互与状态流转', '错误处理与恢复', '测试实施方向']
      .map((title) => `\n## ${title}\n测试场景、前置条件和可观察断言待执行。`)
      .join('');
  await analyzeDocument(html, '', config, {
    fetchImpl: async (_, request) => {
      const body = JSON.parse(request.body);
      if (body.messages[0]?.content.includes('独立的工程范围与安全审查器'))
        return answer('{"decision":"allow"}');
      calls.push(body.messages[1].content);
      return answer(calls.length <= chunks.length ? '失败恢复证据：只重试本段。' : htmlReport);
    },
  });
  assert.equal(calls.length, chunks.length + 1);
  assert.ok(
    calls.every(
      (text) =>
        text.includes('HTML 原型静态提取') &&
        text.includes('跨页面数据') &&
        text.includes('重试/取消/返回/恢复'),
    ),
  );
  assert.match(calls[chunks.length - 1], /末尾规则：失败只重试本段/);
  for (const title of ['端到端业务流程', '关键交互与状态流转', '错误处理与恢复', '测试实施方向'])
    assert.ok(calls.at(-1).includes(`## ${title}`));
  assert.match(calls.at(-1), /所需环境/);
});
