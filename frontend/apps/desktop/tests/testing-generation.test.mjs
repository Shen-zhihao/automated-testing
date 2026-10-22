import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_MODEL } from '../src/settings.mjs';
import { WorkspaceStore } from '../src/store.mjs';
import { TestingService } from '../src/testing/service.mjs';
import { allMaterial, generateTestDocument } from '../src/testing/model.mjs';
import { planBrowserTests, validatePlan } from '../src/testing/automation.mjs';
import { modelAnswer } from './analysis-fixture.mjs';

const config = {
  ...DEFAULT_MODEL,
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: 'private-fixture-secret',
};
const source = {
  id: 'source-fixture',
  name: '计数需求',
  kind: 'md',
  source: '/fixture.md',
  content: '点击增加使计数变为1。失败保留原值。',
  analysis: '### F-001 计数\nAC-001-01 点击增加后变为1。',
};
const task = { name: '计数测试', scope: '全部功能', featureId: '', notes: [], revision: 1 };
const documentPart = (title = '增加计数') => ({
  scope: 'F-001 计数',
  environment: '计数为0',
  strategy: '先正常交互，再验证失败恢复',
  risks: '真实后端状态需另外核验',
  questions: '失败恢复时机待确认',
  cases: [
    {
      title,
      requirement: 'F-001 / AC-001-01 / P-001',
      priority: 'P1',
      preconditions: ['计数为0'],
      steps: ['点击增加'],
      expected: ['计数变为1'],
      automation: '页面文字断言；不代表后端已验证',
    },
  ],
});
const messagesOf = (request) => {
  const body = JSON.parse(request.body);
  return body.messages ?? body.input;
};
const anchorOf = (messages) => JSON.parse(messages.at(-1).content.split('锚点：').at(-1));
const isReview = (messages) => messages[0].content.includes('独立的工程范围与安全审查器');
const outputGroup = (messages) => Number(messages[1].content.match(/当前依据组 (\d+)\//)?.[1]);

for (const format of ['chat-completions', 'responses']) {
  test(`${format}: test document JSON continues at the exact anchor and all calls reserve DeepSeek output for text`, async () => {
    const full = JSON.stringify(documentPart());
    const cut = full.indexOf('expected') + 5;
    let calls = 0;
    const progress = [];
    const result = await generateTestDocument(
      source,
      task,
      { ...config, format },
      {
        fetchImpl: async (_, request) => {
          const body = JSON.parse(request.body);
          assert.equal(body.max_tokens ?? body.max_output_tokens, config.maxTokens);
          assert.equal(
            format === 'responses' ? body.reasoning.effort : body.thinking.type,
            format === 'responses' ? 'none' : 'disabled',
          );
          const messages = messagesOf(request);
          if (isReview(messages)) return modelAnswer('{"decision":"allow"}', 'stop', format);
          calls++;
          assert.match(messages[0].content, /你是测试工程师/);
          assert.doesNotMatch(messages[0].content, /你是需求分析与交付规划助手/);
          if (calls === 1) return modelAnswer(full.slice(0, cut), 'length', format);
          assert.equal(anchorOf(messages), full.slice(0, cut).slice(-120));
          assert.ok(messages.at(-2).content.length <= 3000);
          return modelAnswer(anchorOf(messages) + full.slice(cut), 'stop', format);
        },
      },
      (message) => progress.push(message),
    );
    assert.equal(calls, 2);
    assert.equal(result.cases.length, 1);
    assert.equal(result.cases[0].id, 'TC-001');
    assert.deepEqual(result.cases[0].expected, ['计数变为1']);
    assert.ok(progress.some((message) => message.includes('自动续写')));
  });
}

test('long-material reading also continues truncated text and uses the configured allowance', async () => {
  const summary = '保留 F-001 / AC-001-01 和末尾规则。';
  let tail,
    continuations = 0;
  const requests = [];
  await allMaterial(
    { ...source, content: '原文规则\n'.repeat(5000) + '末尾唯一规则' },
    task,
    { ...config, maxTokens: 16384 },
    {
      fetchImpl: async (_, request) => {
        const body = JSON.parse(request.body);
        assert.equal(body.max_tokens, 16384);
        assert.deepEqual(body.thinking, { type: 'disabled' });
        const messages = messagesOf(request);
        requests.push(messages[1].content);
        if (messages.length > 2) {
          continuations++;
          return modelAnswer(anchorOf(messages) + tail);
        }
        tail = summary.slice(-5);
        return modelAnswer(summary.slice(0, -5), 'length');
      },
    },
    () => {},
  );
  assert.ok(continuations >= 2);
  assert.ok(requests.some((prompt) => prompt.includes('末尾唯一规则')));
});

test('test document checkpoints survive restart, skip completed groups and keep the old report and plan until success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'testing-generation-'));
  const file = path.join(root, 'workspace.sqlite');
  let store = new WorkspaceStore(file);
  let testing;
  t.after(async () => {
    testing?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const doc = store.addDocument({
    ...source,
    content: '首条规则\n' + '中间内容\n'.repeat(1600) + '末尾规则',
  });
  store.saveAnalysis(doc.id, { content: source.analysis, createdAt: '2026-10-21T10:00:00Z' });
  testing = new TestingService({ store, settings: { modelConfig: async () => config } });
  const created = testing.createTask({ documentId: doc.id });
  const saved = testing.db.task(created.id);
  saved.report = { ...documentPart(), id: 'old-report', revision: 1 };
  saved.plan = { id: 'old-plan', reportId: 'old-report' };
  testing.db.saveTask(saved);
  const full = JSON.stringify(documentPart('末尾规则用例'));
  const prefix = full.slice(0, 180);
  let completedNotifications = 0;
  testing.notify = () => {
    if (
      testing.jobs.get(`task:${created.id}`)?.status === 'running' &&
      testing.getTask(created.id).documentDraft?.completed === 1
    )
      completedNotifications++;
  };
  testing.fetchImpl = async (_, request) => {
    const messages = messagesOf(request);
    if (isReview(messages)) return modelAnswer('{"decision":"allow"}');
    if (messages.length > 2) throw new TypeError('offline');
    return outputGroup(messages) === 1
      ? modelAnswer(JSON.stringify(documentPart()))
      : modelAnswer(prefix, 'length');
  };
  await assert.rejects(testing.generateDocument(created.id), /已保存生成进度/);
  assert.ok(completedNotifications > 0);
  assert.deepEqual(testing.getTask(created.id).documentDraft, { completed: 1, total: 2 });
  assert.equal(testing.getTask(created.id).report.id, 'old-report');
  assert.equal(testing.getTask(created.id).plan.id, 'old-plan');
  assert.equal(testing.getTask(created.id).documentCheckpoint, undefined);
  assert.ok(!JSON.stringify(testing.db.task(created.id)).includes(config.apiKey));
  testing.close();
  store.close();
  store = new WorkspaceStore(file);
  const requestedGroups = [];
  testing = new TestingService({
    store,
    settings: { modelConfig: async () => ({ ...config, maxTokens: 8192 }) },
    fetchImpl: async (_, request) => {
      const messages = messagesOf(request);
      if (isReview(messages)) return modelAnswer('{"decision":"allow"}');
      requestedGroups.push(outputGroup(messages));
      assert.equal(anchorOf(messages), prefix.slice(-120));
      return modelAnswer(anchorOf(messages) + full.slice(prefix.length));
    },
  });
  assert.equal(testing.getTask(created.id).documentDraft.completed, 1);
  await testing.generateDocument(created.id);
  assert.deepEqual(requestedGroups, [2]);
  const result = testing.getTask(created.id);
  assert.deepEqual(
    result.report.cases.map((item) => item.id),
    ['TC-001', 'TC-002'],
  );
  assert.equal(result.report.cases[1].title, '末尾规则用例');
  assert.equal(result.reportHistory[0].id, 'old-report');
  assert.equal(result.plan, null);
  assert.equal(result.documentDraft, null);
  assert.equal(testing.db.task(created.id).documentCheckpoint, undefined);
});

test('invalid test output repairs only the failing group', async () => {
  let checkpoint;
  const counts = new Map();
  const result = await generateTestDocument(
    { ...source, content: '规则\n'.repeat(2500) },
    task,
    config,
    {
      onCheckpoint: (value) => {
        checkpoint = structuredClone(value);
      },
      fetchImpl: async (_, request) => {
        const messages = messagesOf(request);
        if (isReview(messages)) return modelAnswer('{"decision":"allow"}');
        const group = outputGroup(messages);
        counts.set(group, (counts.get(group) ?? 0) + 1);
        if (group === 2 && counts.get(group) === 1) return modelAnswer('{"scope":"broken"}');
        if (group === 2) assert.match(messages[1].content, /本机校验反馈/);
        return modelAnswer(JSON.stringify(documentPart(`用例${group}`)));
      },
    },
    () => {},
  );
  assert.equal(counts.get(1), 1);
  assert.equal(counts.get(2), 2);
  assert.equal(result.cases.length, 2);
  assert.equal(checkpoint.steps['output:1'].complete, true);
});

test('cancelling after a truncated response retains the prefix and rejects late successful output', async () => {
  const controller = new AbortController();
  const full = JSON.stringify(documentPart());
  const prefix = full.slice(0, 180);
  let checkpoint,
    calls = 0;
  await assert.rejects(
    generateTestDocument(
      source,
      task,
      config,
      {
        signal: controller.signal,
        onCheckpoint: (value) => {
          checkpoint = structuredClone(value);
        },
        fetchImpl: async (_, request) => {
          const messages = messagesOf(request);
          if (isReview(messages)) return modelAnswer('{"decision":"allow"}');
          calls++;
          if (calls === 1) return modelAnswer(prefix, 'length');
          controller.abort();
          return modelAnswer(anchorOf(messages) + full.slice(prefix.length));
        },
      },
      () => {},
    ),
    /abort|取消/i,
  );
  assert.equal(checkpoint.steps['output:0'].text, prefix);
  assert.equal(checkpoint.steps['output:0'].complete, false);
  const result = await generateTestDocument(
    source,
    task,
    config,
    {
      checkpoint,
      fetchImpl: async (_, request) => {
        const messages = messagesOf(request);
        if (isReview(messages)) return modelAnswer('{"decision":"allow"}');
        assert.equal(anchorOf(messages), prefix.slice(-120));
        return modelAnswer(anchorOf(messages) + full.slice(prefix.length));
      },
    },
    () => {},
  );
  assert.equal(result.cases.length, 1);
});

const planFor = (caseId) => ({
  cases: [
    {
      caseId,
      manualReason: '',
      steps: [
        { action: 'assertText', description: '验证计数为1', value: '计数：1', expectedIndex: 0 },
      ],
    },
  ],
});
const cases = ['TC-001', 'TC-002'].map((id) => ({ ...documentPart().cases[0], id }));
const browser = { snapshot: async () => ({ url: 'https://test.example/', text: '计数：1' }) };

for (const format of ['chat-completions', 'responses']) {
  test(`${format}: browser plans resume per case, validate real assertions and never execute while generating`, async () => {
    let checkpoint;
    const full = JSON.stringify(planFor('TC-002'));
    const prefix = full.slice(0, 70);
    await assert.rejects(
      planBrowserTests(
        browser,
        cases,
        { ...config, format },
        {
          onCheckpoint: (value) => {
            checkpoint = structuredClone(value);
          },
          fetchImpl: async (_, request) => {
            const body = JSON.parse(request.body);
            assert.equal(
              format === 'responses' ? body.reasoning.effort : body.thinking.type,
              format === 'responses' ? 'none' : 'disabled',
            );
            const messages = messagesOf(request);
            if (messages.length > 2) throw new TypeError('offline');
            const selected = JSON.parse(
              messages[1].content.split('选中用例：\n')[1].split('\n')[0],
            );
            assert.equal(selected.length, 1);
            return selected[0].id === 'TC-001'
              ? modelAnswer(JSON.stringify(planFor('TC-001')), 'stop', format)
              : modelAnswer(prefix, 'length', format);
          },
        },
      ),
      /无法连接/,
    );
    assert.equal(checkpoint.steps['output:TC-001'].complete, true);
    let calls = 0;
    const result = await planBrowserTests(
      browser,
      cases,
      { ...config, format, maxTokens: 8192 },
      {
        checkpoint,
        fetchImpl: async (_, request) => {
          calls++;
          const messages = messagesOf(request);
          assert.match(messages[1].content, /TC-002/);
          assert.equal(anchorOf(messages), prefix);
          return modelAnswer(anchorOf(messages) + full.slice(prefix.length), 'stop', format);
        },
      },
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      result.cases.map((item) => item.caseId),
      ['TC-001', 'TC-002'],
    );
    assert.deepEqual(validatePlan(result, cases, result.startUrl), result);
  });
}

test('changed task, model, selected cases or page invalidates saved output instead of continuing obsolete JSON', async () => {
  let checkpoint;
  const full = JSON.stringify(documentPart());
  await generateTestDocument(
    source,
    task,
    config,
    {
      onCheckpoint: (value) => {
        checkpoint = structuredClone(value);
      },
      fetchImpl: async (_, request) =>
        modelAnswer(isReview(messagesOf(request)) ? '{"decision":"allow"}' : full),
    },
    () => {},
  );
  for (const [currentSource, currentTask, currentConfig] of [
    [{ ...source, content: '变更后的需求' }, task, config],
    [source, { ...task, scope: '仅异常恢复' }, config],
    [source, task, { ...config, model: 'deepseek-v4-pro' }],
    [source, task, { ...config, baseUrl: 'http://127.0.0.1:1234/v1' }],
  ]) {
    let calls = 0;
    await generateTestDocument(
      currentSource,
      currentTask,
      currentConfig,
      {
        checkpoint,
        fetchImpl: async (_, request) => {
          const messages = messagesOf(request);
          if (isReview(messages)) return modelAnswer('{"decision":"allow"}');
          calls++;
          assert.equal(messages.length, 2);
          return modelAnswer(full);
        },
      },
      () => {},
    );
    assert.equal(calls, 1);
  }
  await planBrowserTests(browser, cases, config, {
    onCheckpoint: (value) => {
      checkpoint = structuredClone(value);
    },
    fetchImpl: async (_, request) => {
      const messages = messagesOf(request);
      const id = messages[1].content.includes('TC-001') ? 'TC-001' : 'TC-002';
      return modelAnswer(JSON.stringify(planFor(id)));
    },
  });
  for (const [currentBrowser, currentCases] of [
    [{ snapshot: async () => ({ url: 'https://test.example/next', text: '新页面' }) }, cases],
    [browser, [cases[1]]],
  ]) {
    let calls = 0;
    await planBrowserTests(currentBrowser, currentCases, config, {
      checkpoint,
      fetchImpl: async (_, request) => {
        const messages = messagesOf(request);
        calls++;
        assert.equal(messages.length, 2);
        const selected = JSON.parse(messages[1].content.split('选中用例：\n')[1].split('\n')[0]);
        return modelAnswer(JSON.stringify(planFor(selected[0].id)));
      },
    });
    assert.equal(calls, currentCases.length);
  }
});
