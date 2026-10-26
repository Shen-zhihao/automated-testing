import test from 'node:test';
import assert from 'node:assert/strict';
import { completePart } from '../src/model-client.mjs';
import { analyzeDocument } from '../src/model.mjs';
import { answerChat } from '../src/testing/model.mjs';
import { executePlan } from '../src/testing/automation.mjs';
import { DEFAULT_MODEL } from '../src/settings.mjs';
import { modelAnswer, analysisReply } from './analysis-fixture.mjs';
import { mastra } from '../src/mastra/engine.mjs';

const config = { ...DEFAULT_MODEL, model: 'fixture', baseUrl: 'http://127.0.0.1:1/v1' };
const messages = [{ role: 'user', content: '检查当前工程的验收规则。' }];
const noRetainedRuns = async () => {
  for (const workflow of Object.values(mastra.listWorkflows()))
    assert.equal(workflow.runs.size, 0, `${workflow.id} retained a completed run`);
  const storage = mastra.getStorage();
  assert.equal(storage.name, 'InMemoryStorage');
  const workflows = await storage.getStore('workflows');
  assert.equal((await workflows.listWorkflowRuns()).runs.length, 0);
  const memory = await storage.getStore('memory');
  assert.equal((await memory.listThreads({})).threads.length, 0);
};

test('concurrent Mastra agent requests isolate endpoints, secrets, instructions and cancellation', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const controller = new AbortController();
  const first = completePart(
    { ...config, model: 'first', apiKey: 'first-secret' },
    [{ role: 'system', content: 'FIRST INSTRUCTIONS' }, ...messages],
    {
      signal: controller.signal,
      fetchImpl: async (url, request) => {
        assert.equal(url, `${config.baseUrl}/chat/completions`);
        assert.equal(request.headers.Authorization, 'Bearer first-secret');
        const body = JSON.parse(request.body);
        assert.equal(body.model, 'first');
        assert.match(body.messages[0].content, /FIRST INSTRUCTIONS/);
        assert.doesNotMatch(body.messages[0].content, /SECOND INSTRUCTIONS/);
        entered.resolve();
        await release.promise;
        return modelAnswer('late result must be discarded');
      },
    },
  );
  const rejected = assert.rejects(first, /取消/);
  await entered.promise;
  try {
    const second = await completePart(
      {
        ...config,
        model: 'second',
        apiKey: '',
        format: 'responses',
        baseUrl: 'http://127.0.0.1:2/v1',
      },
      [{ role: 'system', content: 'SECOND INSTRUCTIONS' }, ...messages],
      {
        fetchImpl: async (url, request) => {
          assert.equal(url, 'http://127.0.0.1:2/v1/responses');
          assert.equal(request.headers.Authorization, undefined);
          const body = JSON.parse(request.body);
          assert.equal(body.model, 'second');
          assert.equal(body.store, false);
          assert.match(body.input[0].content, /SECOND INSTRUCTIONS/);
          assert.doesNotMatch(body.input[0].content, /FIRST INSTRUCTIONS|first-secret/);
          controller.abort();
          return modelAnswer('second result', 'stop', 'responses');
        },
      },
    );
    assert.equal(second.text, 'second result');
  } finally {
    controller.abort();
    release.resolve();
    await rejected;
  }
  await noRetainedRuns();
});

test('Mastra HTTP failures are not retried and do not start generation after a failed review', async () => {
  let calls = 0;
  const events = [];
  await assert.rejects(
    answerChat({ name: '工程', content: '检查失败恢复', analysis: '' }, { messages }, config, {
      onRuntimeEvent: (event) => events.push(event),
      fetchImpl: async () => {
        calls++;
        return new Response('private remote diagnostic', { status: 503 });
      },
    }),
    /模型请求失败（503）/,
  );
  assert.equal(calls, 1);
  assert.ok(events.some((event) => event.type === 'workflow' && event.id === 'chat-answer'));
  assert.ok(events.some((event) => event.type === 'agent' && event.id === 'reviewer'));
  assert.ok(!events.some((event) => event.type === 'agent' && event.id === 'assistant'));
  await noRetainedRuns();
});

test('a legacy checkpoint resumes through Mastra without rewriting completed sections or storing credentials', async () => {
  const document = {
    name: '登录需求',
    kind: 'md',
    source: '/fixture.md',
    content: '密码错误 5 次后锁定。',
  };
  let checkpoint;
  const events = [];
  await assert.rejects(
    analyzeDocument(
      document,
      '',
      { ...config, apiKey: 'private-key' },
      {
        onCheckpoint: (state) => {
          checkpoint = structuredClone(state);
        },
        fetchImpl: async (_, request) => {
          const { messages } = JSON.parse(request.body);
          if (messages[1].content.includes('AC 编号从')) throw new TypeError('offline');
          return modelAnswer(analysisReply(messages));
        },
      },
    ),
    /无法连接/,
  );
  assert.ok(checkpoint.steps['catalog:0'].complete);
  assert.ok(checkpoint.steps['steps:F-001:0'].complete);
  assert.doesNotMatch(JSON.stringify(checkpoint), /private-key|apiKey|requestContext/);
  const result = await analyzeDocument(document, '', config, {
    checkpoint,
    onRuntimeEvent: (event) => events.push(event),
    fetchImpl: async (_, request) => {
      const { messages } = JSON.parse(request.body);
      if (!messages[0].content.includes('独立的工程范围与安全审查器'))
        assert.match(messages[1].content, /AC 编号从/);
      return modelAnswer(analysisReply(messages));
    },
  });
  assert.match(result.content, /AC-001-01/);
  assert.ok(events.some((event) => event.type === 'workflow' && event.id === 'text-continuation'));
  assert.ok(events.some((event) => event.type === 'agent' && event.id === 'requirements'));
  await noRetainedRuns();
});

test('Mastra executes reviewed browser cases serially and never replays a failed operation', async () => {
  const actions = [];
  const events = [];
  const step = { action: 'click', description: '点击增加', locator: { by: 'text', value: '增加' } };
  let active = false;
  const result = await executePlan(
    {
      goto: async () => {
        actions.push('goto');
      },
      perform: async () => {
        assert.equal(active, false);
        active = true;
        actions.push('click');
        await Promise.resolve();
        active = false;
        throw new Error('实际控件不可用');
      },
    },
    {
      startUrl: 'https://test.example/',
      cases: [
        { caseId: 'TC-001', steps: [step] },
        { caseId: 'TC-002', steps: [step] },
      ],
    },
    { onRuntimeEvent: (event) => events.push(event) },
  );
  assert.deepEqual(actions, ['goto', 'click']);
  assert.deepEqual(
    result.map((item) => item.status),
    ['failed', 'skipped'],
  );
  assert.match(result[0].steps[0].evidence, /实际控件不可用/);
  assert.equal(events.filter((event) => event.type === 'tool').length, 2);
  await noRetainedRuns();
});
