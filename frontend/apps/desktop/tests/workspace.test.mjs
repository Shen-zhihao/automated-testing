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
      calls.push(body);
      return answer(calls.length <= 3 ? '分段笔记：锁定条件' : '# 测试场景\n验证锁定');
    },
  });
  assert.equal(analysis.segments, 3);
  assert.ok(calls.some((call) => call.messages[1].content.includes('尾部独有需求')));
  assert.equal(calls.length, 4);
  assert.match(calls[3].messages[1].content, /分段分析笔记/);
  assert.equal(progress.at(-1), '正在生成完整分析');
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
  service.fetchImpl = async () => answer('new report');
  await service.analyze(id, '');
  assert.equal(store.getDocument(id).analysis.content, 'new report');
  store.close();
});
