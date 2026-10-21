import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/store.mjs';
import { SettingsService, DEFAULT_MODEL } from '../src/settings.mjs';
import { TestingService } from '../src/testing/service.mjs';
import {
  browserAddress,
  browserNavigationAllowed,
  BROWSER_PARTITION,
} from '../src/testing/browser-policy.mjs';
import { extractFeatures } from '../src/testing/store.mjs';
import { validatePlan, executePlan, redactObject } from '../src/testing/automation.mjs';
import { allMaterial } from '../src/testing/model.mjs';

const vault = {
  encrypt: async (text) => Buffer.from([...text].reverse().join('')),
  decrypt: async (value) => [...value.toString()].reverse().join(''),
};
const source = {
  name: '计数需求',
  source: '/fixture.md',
  kind: 'md',
  content: '点击增加，计数由0变为1。失败保留原值。',
  warnings: [],
};
const analysis = {
  kind: 'implementation-plan',
  content:
    '## 功能清单\n| F-001 | 计数功能 |\n## 功能实现步骤\n### F-001 计数功能\nS-001-01 点击增加。\n## 功能验收标准\nAC-001-01 计数变为1。',
  createdAt: '2026-10-20T08:00:00Z',
};
const testDoc = {
  scope: 'F-001 计数功能；不包含后端账务。',
  environment: '登录测试账号，计数初始为0。',
  strategy: '先正常交互，再验证失败。',
  risks: '无法由前端证明后端账务正确。',
  questions: '暂无已知问题。',
  cases: [
    {
      title: '增加计数',
      requirement: 'F-001 / AC-001-01 / P-001',
      priority: 'P1',
      preconditions: ['计数为0'],
      steps: ['点击增加'],
      expected: ['计数变为1'],
      automation: '页面控件和可见文字断言',
    },
  ],
};
const reply = (text) =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }),
  );
async function setup(
  file = ':memory:',
  fetchImpl = async (_, options) =>
    reply(
      JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
        ? '{"decision":"allow"}'
        : '依据 F-001 [P-001]：检查点击后数值为1，失败不改变原值。',
    ),
) {
  const store = new WorkspaceStore(file),
    settings = new SettingsService(store, { ...vault });
  await settings.save({
    model: { ...DEFAULT_MODEL, baseUrl: 'http://127.0.0.1:5201/v1', model: 'fixture' },
    apiKey: '',
    clearApiKey: false,
  });
  const doc = store.addDocument(source);
  store.saveAnalysis(doc.id, analysis);
  const testing = new TestingService({ store, settings, fetchImpl });
  return { store, settings, testing, doc };
}
const casePlan = {
  cases: [
    {
      caseId: 'TC-001',
      manualReason: '',
      steps: [
        { action: 'click', description: '点击增加', locator: { by: 'text', value: '增加' } },
        { action: 'assertText', description: '检查计数为1', value: '计数：1', expectedIndex: 0 },
      ],
    },
  ],
};

test('document → persisted chat → idempotent retained result → detailed report; snapshots survive source edits/deletion and restart', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testing-flow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'workspace.sqlite');
  const { store, testing, doc } = await setup(file);
  const chat = testing.createSession({ documentId: doc.id, featureId: 'F-001' });
  const answer = await testing.sendMessage(chat.id, '如何验收这个功能？');
  assert.match(answer.messages.at(-1).content, /P-001/);
  assert.ok(answer.messages.at(-1).excerpts.length);
  const task = testing.keepMessage(chat.id, answer.messages.at(-1).id);
  assert.equal(task.notes.length, 1);
  assert.equal(testing.keepMessage(chat.id, answer.messages.at(-1).id).notes.length, 1);
  testing.fetchImpl = async (_, options) =>
    reply(
      JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
        ? '{"decision":"allow"}'
        : JSON.stringify(testDoc),
    );
  await testing.generateDocument(task.id);
  assert.match(testing.getTask(task.id).report.markdown, /需求与用例对应/);
  assert.match(testing.exportDocument(task.id).analysis.content, /所有用例均未验证/);
  store.updateDocumentSource(doc.id, { content: '新需求不再计数' });
  store.deleteDocument(doc.id);
  assert.equal(testing.getTask(task.id).source.changed, true);
  assert.match(testing.db.source(task.sourceId).content, /计数/);
  store.close();
  const reopened = new WorkspaceStore(file);
  const service = new TestingService({
    store: reopened,
    settings: new SettingsService(reopened, vault),
  });
  assert.equal(service.getSession(chat.id).messages.length, 2);
  assert.equal(service.getTask(task.id).notes.length, 1);
  assert.match(service.getTask(task.id).report.markdown, /AC-001-01/);
  reopened.close();
});

test('cross-document result retention is rejected; changing scope invalidates report and plan; failed generation retains report', async () => {
  const { store, testing, doc } = await setup();
  try {
    const chat = testing.createSession({ documentId: doc.id });
    const answer = await testing.sendMessage(chat.id, '测试');
    const task = testing.keepMessage(chat.id, answer.messages.at(-1).id);
    const other = store.addDocument({ ...source, name: '另一文档' });
    store.saveAnalysis(other.id, analysis);
    const otherTask = testing.createTask({ documentId: other.id });
    assert.throws(
      () => testing.keepMessage(chat.id, answer.messages.at(-1).id, otherTask.id),
      /其他需求版本/,
    );
    testing.fetchImpl = async (_, options) =>
      reply(
        JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
          ? '{"decision":"allow"}'
          : JSON.stringify(testDoc),
      );
    await testing.generateDocument(task.id);
    const report = testing.getTask(task.id).report;
    testing.fetchImpl = async (_, options) =>
      reply(
        JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
          ? '{"decision":"allow"}'
          : '{}',
      );
    await assert.rejects(testing.generateDocument(task.id), /测试文档/);
    assert.equal(testing.getTask(task.id).report.id, report.id);
    testing.updateTask(task.id, {
      name: task.name,
      scope: '新增失败重试范围',
      url: 'http://127.0.0.1:5201',
    });
    assert.equal(testing.getTask(task.id).reportStale, true);
    assert.equal(testing.getTask(task.id).plan, null);
  } finally {
    store.close();
  }
});

function fakeBrowser(url, options) {
  return {
    url,
    options,
    visible: true,
    secrets: [],
    closeCount: 0,
    browseCount: 0,
    attached: false,
    alive() {
      return this.closeCount === 0;
    },
    browse(value) {
      this.url = value;
      this.browseCount++;
    },
    info() {
      return {
        open: this.alive(),
        url: this.url,
        title: '测试页面',
        loading: false,
        error: '',
        canGoBack: false,
        canGoForward: false,
      };
    },
    attach(_parent, bounds) {
      this.attached = Boolean(bounds);
    },
    close() {
      this.closeCount++;
    },
    beginAutomation(value) {
      this.automationOrigin = new URL(value).origin;
    },
    endAutomation() {
      this.automationOrigin = null;
    },
    async goto(value) {
      this.url = value;
    },
    async perform() {
      return '实际断言完成';
    },
  };
}

test('browser opening reuses the task page and never retrieves or submits stored credentials', async () => {
  const { store, testing, doc } = await setup();
  try {
    testing.browserFactory = fakeBrowser;
    store.db
      .prepare('INSERT INTO browser_accounts VALUES (?, ?)')
      .run(
        'https://one.example',
        JSON.stringify({ encrypted: 'legacy-kept', updatedAt: '2026-10-20' }),
      );
    const task = testing.createTask({ documentId: doc.id });
    testing.updateTask(task.id, {
      name: task.name,
      scope: task.scope,
      url: 'https://one.example/',
    });
    assert.equal(testing.openBrowser(task.id), task.id);
    const browser = testing.browsers.get(task.id);
    assert.equal(browser.browseCount, 1);
    browser.url = 'https://one.example/dashboard';
    testing.hideBrowser(task.id);
    assert.equal(testing.browserTabs().length, 0);
    assert.equal(browser.alive(), true);
    testing.openBrowser(task.id);
    assert.equal(browser.url, 'https://one.example/dashboard');
    assert.equal(browser.browseCount, 1);
    assert.equal(testing.browserTabs()[0].id, task.id);
    const popupContents = { id: 'native-popup-contents' };
    const popup = browser.options.onPopup('https://login.example/', { webContents: popupContents });
    assert.equal(popup.options.webContents, popupContents);
    assert.equal(popup.parentId, task.id);
    assert.equal(testing.browserTabs().length, 2);
    testing.loadBrowser(task.id, 'https://other.example/');
    assert.equal(browser.url, 'https://other.example/');
    assert.equal(testing.snapshot().browserSites, undefined);
    assert.match(store.db.prepare('SELECT data FROM browser_accounts').get().data, /legacy-kept/);
  } finally {
    testing.close();
    store.close();
  }
});

test('closing a visible webpage tab does not abort a running test or destroy its browser', async () => {
  const { store, testing, doc } = await setup();
  try {
    testing.browserFactory = fakeBrowser;
    const task = testing.createTask({ documentId: doc.id });
    testing.updateTask(task.id, {
      name: task.name,
      scope: task.scope,
      url: 'https://one.example/',
    });
    testing.fetchImpl = async (_, options) =>
      reply(
        JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
          ? '{"decision":"allow"}'
          : JSON.stringify(testDoc),
      );
    await testing.generateDocument(task.id);
    const saved = testing.db.task(task.id);
    saved.plan = {
      ...validatePlan(casePlan, saved.report.cases, saved.url),
      reportId: saved.report.id,
      revision: saved.revision,
    };
    testing.db.saveTask(saved);
    testing.openBrowser(task.id);
    const browser = testing.browsers.get(task.id);
    let release, started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    browser.perform = async () => {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return '计数为1';
    };
    const pending = testing.run(task.id);
    await ready;
    testing.hideBrowser(task.id);
    testing.retention.reap(Date.now() + 10 * 60_000);
    assert.equal(browser.alive(), true);
    assert.equal(testing.controllers.get(`task:${task.id}`).signal.aborted, false);
    assert.equal(testing.browserTabs().length, 0);
    browser.perform = async () => '计数为1';
    release();
    await pending;
    assert.equal(testing.getTask(task.id).runs[0].status, 'passed');
    assert.equal(browser.automationOrigin, null);
    assert.equal(browser.closeCount, 0);
  } finally {
    testing.close();
    store.close();
  }
});

test('a retired task browser is recreated in the background when its reviewed plan runs', async () => {
  const { store, testing, doc } = await setup();
  try {
    testing.browserFactory = fakeBrowser;
    const task = testing.createTask({ documentId: doc.id });
    testing.updateTask(task.id, {
      name: task.name,
      scope: task.scope,
      url: 'https://one.example/',
    });
    testing.fetchImpl = async (_, options) =>
      reply(
        JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
          ? '{"decision":"allow"}'
          : JSON.stringify(testDoc),
      );
    await testing.generateDocument(task.id);
    const saved = testing.db.task(task.id);
    saved.plan = {
      ...validatePlan(casePlan, saved.report.cases, saved.url),
      reportId: saved.report.id,
      revision: saved.revision,
    };
    testing.db.saveTask(saved);
    testing.openBrowser(task.id);
    const previous = testing.browsers.get(task.id);
    testing.hideBrowser(task.id);
    testing.retention.reap(Date.now() + 10 * 60_000);
    assert.equal(previous.alive(), false);
    assert.equal(testing.browsers.size, 0);
    await testing.run(task.id);
    assert.equal(testing.getTask(task.id).runs[0].status, 'passed');
    assert.equal(testing.browsers.get(task.id).url, saved.plan.startUrl);
    assert.equal(testing.browserTabs().length, 0);
    assert.notEqual(testing.browsers.get(task.id), previous);
  } finally {
    testing.close();
    store.close();
  }
});

test('list snapshots and source references omit heavy document, message and report payloads', async (t) => {
  const { store, testing, doc } = await setup();
  try {
    const chat = testing.createSession({ documentId: doc.id });
    const answer = await testing.sendMessage(chat.id, '验收要求');
    const task = testing.keepMessage(chat.id, answer.messages.at(-1).id);
    testing.fetchImpl = async (_, options) =>
      reply(
        JSON.parse(options.body).messages[0]?.content.includes('独立的工程范围与安全审查器')
          ? '{"decision":"allow"}'
          : JSON.stringify(testDoc),
      );
    await testing.generateDocument(task.id);
    const heavy = () => {
      throw new Error('summary must not load full JSON payloads');
    };
    for (const method of ['task', 'session', 'source', 'runs'])
      t.mock.method(testing.db, method, heavy);
    t.mock.method(store, 'getDocument', heavy);
    const snapshot = testing.snapshot();
    assert.equal(snapshot.testSessions[0].taskId, task.id);
    assert.equal(snapshot.testSessions[0].messages, undefined);
    assert.equal(snapshot.testTasks[0].documentName, source.name);
    assert.equal(snapshot.testTasks[0].hasReport, true);
    assert.equal(snapshot.testTasks[0].reportStale, false);
    assert.equal(snapshot.testTasks[0].noteCount, 1);
    assert.equal(snapshot.testTasks[0].report, undefined);
    assert.equal(testing.sourceState(task.sourceId).changed, false);
    store.db.prepare('UPDATE documents SET content = ? WHERE id = ?').run('updated', doc.id);
    assert.equal(testing.sourceState(task.sourceId).changed, true);
    assert.deepEqual(testing.sourceState(task.sourceId).features, [
      { id: 'F-001', title: '计数功能' },
    ]);
    for (let i = 0; i < 5; i++)
      testing.db.saveRun({
        id: `run-${i}`,
        taskId: task.id,
        status: 'passed',
        message: `run ${i}`,
        createdAt: `2026-10-21T00:00:0${i}Z`,
        steps: [{ evidence: 'large payload' }],
      });
    const recent = testing.db.recentRunSummaries(task.id);
    assert.equal(recent.length, 3);
    assert.deepEqual(
      recent.map((run) => run.message),
      ['run 4', 'run 3', 'run 2'],
    );
    assert.equal(recent[0].steps, undefined);
  } finally {
    testing.close();
    store.close();
  }
});

test('ordinary browsing accepts cross-site HTTP pages while retaining protocol and credential URL boundaries', () => {
  assert.match(BROWSER_PARTITION, /^persist:/);
  assert.equal(browserAddress('example.com/path'), 'https://example.com/path');
  assert.equal(browserAddress('localhost:5201/path'), 'http://localhost:5201/path');
  assert.equal(browserAddress(''), 'about:blank');
  for (const value of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'test-agent://app',
    'https://user:pass@example.com',
  ]) {
    assert.throws(() => browserAddress(value));
    assert.equal(browserNavigationAllowed(value), false);
  }
  assert.equal(browserNavigationAllowed('https://auth.other.example/login'), true);
  assert.equal(browserNavigationAllowed('about:blank'), true);
  assert.deepEqual(redactObject({ value: 'secret' }, ['secret']), { value: '[已隐藏]' });
});

test('plans reject arbitrary code, off-origin navigation, missing expected assertions and duplicate cases', () => {
  const cases = [{ ...testDoc.cases[0], id: 'TC-001' }];
  assert.equal(validatePlan(casePlan, cases, 'https://test.example/').cases.length, 1);
  for (const steps of [
    [{ action: 'evaluate', description: '执行脚本' }],
    [{ action: 'goto', description: '离开站点', value: 'https://other.example/' }],
    [{ action: 'click', description: '点击按钮', locator: { by: 'text', value: '增加' } }],
    [{ action: 'assertText', description: '检查', value: '完成', expectedIndex: 5 }],
  ])
    assert.throws(() =>
      validatePlan({ cases: [{ caseId: 'TC-001', steps }] }, cases, 'https://test.example/'),
    );
  assert.throws(() =>
    validatePlan({ cases: [...casePlan.cases, ...casePlan.cases] }, cases, 'https://test.example/'),
  );
  assert.equal(
    validatePlan(
      { cases: [{ caseId: 'TC-001', manualReason: '需要验证码', steps: [] }] },
      cases,
      'https://test.example/',
    ).cases[0].steps.length,
    0,
  );
});

test('runner records actual assertion failure, skips later cases and never marks unrun work passed', async () => {
  let calls = 0;
  const browser = {
    goto: async () => {},
    perform: async (step) => {
      calls++;
      if (step.action === 'assertText') throw new Error('页面未出现预期文字。');
      return '点击完成';
    },
  };
  const plan = {
    startUrl: 'https://test.example',
    cases: [
      ...casePlan.cases,
      { ...casePlan.cases[0], caseId: 'TC-002' },
      { caseId: 'TC-003', manualReason: '需要人工核验', steps: [] },
    ],
  };
  const result = await executePlan(browser, plan);
  assert.equal(result[0].status, 'failed');
  assert.equal(result[0].steps[1].status, 'failed');
  assert.equal(result[1].status, 'skipped');
  assert.equal(result[2].status, 'manual');
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(executePlan(browser, plan, { signal: controller.signal }), /取消/);
});

test('interrupted run recovery retains evidence without a success result', async () => {
  const { store, testing, doc } = await setup();
  try {
    const task = testing.createTask({ documentId: doc.id });
    testing.db.saveRun({
      id: 'interrupted',
      taskId: task.id,
      createdAt: '2026-10-20',
      status: 'running',
      steps: [{ status: 'passed' }],
    });
    const restarted = new TestingService({ store, settings: testing.settings });
    assert.equal(restarted.getTask(task.id).runs[0].status, 'cancelled');
    assert.equal(restarted.getTask(task.id).runs[0].steps.length, 1);
  } finally {
    store.close();
  }
});

test('long requirement reading covers tail evidence rather than dropping later requirements', async () => {
  const { store, testing, doc } = await setup();
  try {
    const task = testing.createTask({ documentId: doc.id });
    const sourceSnapshot = {
      ...testing.db.source(task.sourceId),
      content: '第一条要求\n' + '中间文字\n'.repeat(4500) + '最后独有规则：退款后禁止重试',
    };
    const requests = [];
    await allMaterial(
      sourceSnapshot,
      task,
      await testing.settings.modelConfig(),
      {
        fetchImpl: async (_, options) => {
          const body = JSON.parse(options.body);
          requests.push(body.messages[1].content);
          return reply('保留规则摘要。');
        },
      },
      () => {},
    );
    assert.ok(requests.length >= 2);
    assert.ok(requests.some((text) => text.includes('最后独有规则')));
  } finally {
    store.close();
  }
});

test('feature extraction ignores fenced examples and deduplicates headings/table entries', () => {
  assert.deepEqual(
    extractFeatures('```md\n### F-999 示例\n```\n| F-001 | 登录 |\n### F-001 登录\n### F-002 退出'),
    [
      { id: 'F-001', title: '登录' },
      { id: 'F-002', title: '退出' },
    ],
  );
});
