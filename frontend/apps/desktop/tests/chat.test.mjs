import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/store.mjs';
import { DEFAULT_MODEL } from '../src/settings.mjs';
import { TestingService } from '../src/testing/service.mjs';
import { parseChatReply } from '../src/testing/model.mjs';
import { WorkspaceService } from '../src/workspace.mjs';
import { TerminalService } from '../src/terminal/service.mjs';
import { DEFAULT_PROJECT_ID, assertProjectOperation } from '../src/projects.mjs';

const config = { ...DEFAULT_MODEL, baseUrl: 'http://127.0.0.1:5201/v1', model: 'fixture' };
const document = (name, content, extra = {}) => ({
  name,
  content,
  source: `/fixture/${name}.md`,
  kind: 'md',
  warnings: [],
  ...extra,
});
function setup(t, file = ':memory:') {
  const store = new WorkspaceStore(file);
  const calls = [];
  const testing = new TestingService({
    store,
    settings: { modelConfig: async () => config },
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      const review = body.messages[0].content.includes('独立的工程范围与安全审查器');
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: review
                  ? '{"decision":"allow"}'
                  : '可以先梳理工程范围，再补充可验证的步骤。',
              },
            },
          ],
        }),
      );
    },
  });
  t.after(async () => {
    testing.close();
    await testing.terminal?.close?.();
    store.close();
  });
  return { store, testing, calls };
}

test('chat envelopes expose Markdown without requiring command metadata or changing literal escapes', () => {
  const markdown =
    '## 直接结论\n\n| 场景 | 工期 |\n| --- | --- |\n| 基准 | **4–6 周** |\n\n- 待确认排期\n\n`C:\\new\\test` 与 `\\n` 保持原样。';
  for (const metadata of [
    {},
    { commands: [] },
    { commands: null },
    { commands: 'invalid' },
    { commands: [{ command: 'pwd', reason: '检查目录' }, null] },
    { commands: Array(4).fill({ command: 'pwd', reason: '检查目录' }) },
  ]) {
    const wrapped = JSON.stringify({ answer: markdown, ...metadata });
    for (const content of [wrapped, `\`\`\`json\n${wrapped}\n\`\`\``])
      assert.deepEqual(parseChatReply(content), { content: markdown, commands: [] });
  }
  assert.deepEqual(parseChatReply(markdown), { content: markdown, commands: [] });
  const codeExample = '```json\n{"path":"C:\\\\new"}\n```';
  assert.equal(parseChatReply(codeExample).content, codeExample);
});

test('new structured replies save readable Markdown through both supported model APIs', async (t) => {
  for (const format of ['chat-completions', 'responses'])
    await t.test(format, async (t) => {
      const { testing } = setup(t);
      testing.settings.modelConfig = async () => ({ ...config, format });
      const markdown = '## 工程排期\n\n| 场景 | 工期 |\n| --- | --- |\n| 基准 | **4–6 周** |';
      const wrapped = JSON.stringify({ answer: markdown });
      testing.fetchImpl = async (_, options) => {
        const body = JSON.parse(options.body);
        const messages = body.messages || body.input;
        const content = messages[0].content.includes('独立的工程范围与安全审查器')
          ? '{"decision":"allow"}'
          : wrapped;
        return new Response(
          JSON.stringify(
            format === 'responses'
              ? {
                  status: 'completed',
                  output: [{ content: [{ type: 'output_text', text: content }] }],
                }
              : { choices: [{ finish_reason: 'stop', message: { content } }] },
          ),
        );
      };
      const chat = testing.createSession({});
      const result = await testing.sendMessage(chat.id, '评估工程排期', []);
      assert.equal(result.messages[1].content, markdown);
      assert.equal(testing.db.session(chat.id).messages[1].content, markdown);
      assert.deepEqual(result.messages[1].commandIds, []);
    });
});

test('legacy wrapped replies display, retain and enter model history as Markdown while original records and user text stay intact', async (t) => {
  const { store, testing, calls } = setup(t);
  const doc = store.addDocument(document('工程需求', '工程验收依据'));
  const chat = testing.createSession({ documentId: doc.id });
  const markdown = '## 历史结论\n\n- **保留验收依据**\n- 下一步确认排期';
  const wrapped = JSON.stringify({ answer: markdown });
  const userText = '{"answer":"这是用户提供的 JSON 示例"}';
  testing.db.saveSession({
    ...testing.db.session(chat.id),
    messages: [
      {
        id: 'user',
        role: 'user',
        content: userText,
        status: 'complete',
        sourceIds: [chat.sourceId],
      },
      {
        id: 'legacy',
        role: 'assistant',
        content: wrapped,
        status: 'complete',
        sourceIds: [chat.sourceId],
      },
    ],
  });
  const restored = testing.getSession(chat.id);
  assert.equal(restored.messages[0].content, userText);
  assert.equal(restored.messages[1].content, markdown);
  assert.equal(restored.messages[1].references[0].documentId, doc.id);
  assert.equal(testing.db.session(chat.id).messages[1].content, wrapped);
  const task = testing.keepMessage(chat.id, 'legacy');
  assert.equal(task.notes[0].content, markdown);
  await testing.sendMessage(chat.id, '继续讨论工程验收', []);
  const history = calls[1].messages;
  assert.equal(history.find((message) => message.role === 'assistant').content, markdown);
  assert.ok(history.some((message) => message.content === userText));
  assert.equal(testing.db.session(chat.id).messages[1].content, wrapped);
});

test('a new chat sends without documents, names itself from the first question and survives restart', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'direct-chat-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'workspace.sqlite');
  const { store, testing, calls } = setup(t, file);
  store.addDocument(document('未引用资料', 'SHOULD_NOT_BE_SENT'));
  const chat = testing.createSession({});
  assert.equal(chat.source, null);
  assert.equal(chat.sourceId, null);
  const result = await testing.sendMessage(chat.id, '帮我梳理这个工程的测试思路', []);
  assert.equal(result.title, '帮我梳理这个工程的测试思路');
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages[1].excerpts, []);
  assert.deepEqual(result.messages[1].references, []);
  assert.ok(!JSON.stringify(calls).includes('SHOULD_NOT_BE_SENT'));
  assert.throws(() => testing.keepMessage(chat.id, result.messages[1].id), /未引用/);
  const reopened = new WorkspaceStore(file);
  const restored = new TestingService({ store: reopened, settings: {} });
  assert.equal(restored.getSession(chat.id).messages.length, 2);
  assert.equal(restored.snapshot().testSessions[0].sourceId, null);
  restored.close();
  reopened.close();
});

test('optional references include raw and analyzed documents, preserve versions and can be removed next turn', async (t) => {
  const { store, testing, calls } = setup(t);
  const raw = store.addDocument(
    document('交互草稿', 'RAW_CLICK_RULE', { warnings: ['图片尚未解析'] }),
  );
  const analyzed = store.addDocument(document('验收依据', 'ANALYZED_RULE'));
  store.saveAnalysis(analyzed.id, {
    content: '### F-001 验收\nAC-001-01 校验结果',
    createdAt: '2026-10-21',
  });
  store.addDocument(document('未选择的文档', 'PRIVATE_UNSELECTED_TEXT'));
  const chat = testing.createSession({});
  const result = await testing.sendMessage(chat.id, '比较这两份资料的验收步骤', [
    raw.id,
    analyzed.id,
  ]);
  const answer = result.messages[1];
  assert.deepEqual(
    answer.references.map((item) => item.documentId),
    [raw.id, analyzed.id],
  );
  assert.equal(answer.references[0].analysisCreatedAt, '');
  assert.equal(answer.references[0].changed, false);
  assert.deepEqual(answer.references[0].warnings, ['图片尚未解析']);
  assert.deepEqual(
    answer.excerpts.map((item) => item.id),
    ['D1-P-001', 'D2-P-001'],
  );
  const material = calls[1].messages[1].content;
  assert.match(material, /RAW_CLICK_RULE/);
  assert.match(material, /ANALYZED_RULE/);
  assert.match(material, /AC-001-01/);
  assert.match(material, /图片尚未解析/);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_UNSELECTED_TEXT'));
  store.updateDocumentSource(raw.id, { content: 'CHANGED_RAW_RULE' });
  assert.match(testing.db.source(answer.references[0].id).content, /RAW_CLICK_RULE/);
  assert.equal(testing.getSession(chat.id).messages[1].references[0].changed, true);
  const next = await testing.sendMessage(chat.id, '接下来如何组织工程检查？', []);
  assert.deepEqual(next.messages[3].references, []);
  assert.deepEqual(next.messages[3].excerpts, []);
  assert.match(calls[4].messages[1].content, /本轮未引用文档/);
  assert.ok(!calls[4].messages[1].content.includes('RAW_CLICK_RULE'));
});

test('retained conclusions follow the particular reply reference instead of another turn or feature', async (t) => {
  const { store, testing } = setup(t);
  const first = store.addDocument(document('原始需求', '首个需求'));
  store.saveAnalysis(first.id, { content: '### F-001 原始功能', createdAt: '2026-10-21' });
  const second = store.addDocument(document('补充需求', '另一份需求'));
  const chat = testing.createSession({ documentId: first.id, featureId: 'F-001' });
  const initial = await testing.sendMessage(chat.id, '原始功能怎么验收？');
  const originalTask = testing.keepMessage(chat.id, initial.messages[1].id);
  const next = await testing.sendMessage(chat.id, '讨论补充需求', [second.id]);
  const otherTask = testing.keepMessage(chat.id, next.messages[3].id);
  assert.equal(otherTask.source.documentId, second.id);
  assert.equal(otherTask.featureId, '');
  assert.notEqual(originalTask.id, otherTask.id);
  assert.throws(
    () => testing.keepMessage(chat.id, next.messages[3].id, originalTask.id),
    /其他需求版本/,
  );
  assert.equal(
    testing.keepMessage(chat.id, initial.messages[1].id, originalTask.id).notes.length,
    1,
  );
  const created = testing.keepMessage(chat.id, next.messages[3].id, '');
  assert.notEqual(created.id, otherTask.id);
});

test('reference validation rejects foreign projects and malformed inputs before recording a user message', async (t) => {
  const { store, testing, calls } = setup(t);
  const other = store.projects.create({ name: '其他工程' });
  const foreign = store.addDocument(
    document('其他工程需求', 'FOREIGN_CONTENT', { projectId: other.id }),
  );
  const chat = testing.createSession({});
  for (const references of [[foreign.id], Array(6).fill('document'), 'document', [null]])
    await assert.rejects(testing.sendMessage(chat.id, '测试引用边界', references), /不属于|最多/);
  assert.equal(testing.getSession(chat.id).messages.length, 0);
  assert.equal(calls.length, 0);
  assert.throws(
    () =>
      assertProjectOperation(store, 'chat-send', DEFAULT_PROJECT_ID, [
        chat.id,
        '问题',
        [foreign.id],
      ]),
    /不属于/,
  );
  assert.throws(
    () => assertProjectOperation(store, 'chat-send', DEFAULT_PROJECT_ID, [chat.id, '问题', 'id']),
    /最多/,
  );
});

test('deleting a chat persists across restart while preserving other chats, documents and retained task data', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'delete-chat-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'workspace.sqlite');
  const { store, testing } = setup(t, file);
  const doc = store.addDocument(document('保留的需求', '保留原文'));
  const chat = testing.createSession({});
  const other = testing.createSession({});
  const result = await testing.sendMessage(chat.id, '讨论需求并保留结论', [doc.id]);
  const task = testing.keepMessage(chat.id, result.messages[1].id);
  testing.db.saveRun({
    id: 'retained-run',
    taskId: task.id,
    createdAt: '2026-10-21',
    status: 'passed',
    cases: [],
  });
  const savedTask = testing.getTask(task.id);
  assert.equal(savedTask.sessionId, chat.id);
  assert.equal(testing.jobs.has(`chat:${chat.id}`), true);
  testing.deleteSession(chat.id);
  assert.throws(() => testing.getSession(chat.id), /对话不存在/);
  assert.throws(() => testing.deleteSession(chat.id), /对话不存在/);
  assert.equal(testing.jobs.has(`chat:${chat.id}`), false);
  assert.deepEqual(
    testing.snapshot().testSessions.map((item) => item.id),
    [other.id],
  );
  assert.deepEqual(testing.getTask(task.id), savedTask);
  assert.equal(store.getDocument(doc.id).content, '保留原文');
  assert.equal(store.projects.list()[0].chatCount, 1);

  const reopened = new WorkspaceStore(file);
  const restored = new TestingService({ store: reopened, settings: {} });
  try {
    assert.throws(() => restored.getSession(chat.id), /对话不存在/);
    assert.equal(restored.getSession(other.id).id, other.id);
    assert.deepEqual(restored.getTask(task.id), savedTask);
    const continuation = restored.createSession({ taskId: task.id });
    assert.equal(continuation.taskId, task.id);
    assert.equal(continuation.source.documentId, doc.id);
  } finally {
    restored.close();
    reopened.close();
  }
});

test('a running or cancelling reply cannot be deleted before it settles', async (t) => {
  const { testing } = setup(t);
  const chat = testing.createSession({});
  const other = testing.createSession({});
  let release;
  testing.settings.modelConfig = () => new Promise((resolve) => (release = resolve));
  const sending = testing.sendMessage(chat.id, '等待中的问题', []);
  const cancelled = assert.rejects(sending, /取消/);
  assert.throws(() => testing.deleteSession(chat.id), /等待或取消/);
  testing.deleteSession(other.id);
  assert.equal(testing.getSession(chat.id).id, chat.id);
  testing.cancel(`chat:${chat.id}`);
  assert.throws(() => testing.deleteSession(chat.id), /等待或取消/);
  release(config);
  await cancelled;
  testing.deleteSession(chat.id);
  assert.throws(() => testing.getSession(chat.id), /对话不存在/);
  assert.equal(testing.snapshot().testSessions.length, 0);
  assert.deepEqual(testing.snapshot().testJobs, {});
});

test('chat deletion validates the selected project before touching a conversation', (t) => {
  const { store, testing } = setup(t);
  const other = store.projects.create({ name: '另一工程' });
  const chat = testing.createSession({});
  const foreign = testing.createSession({ projectId: other.id });
  assert.throws(
    () => assertProjectOperation(store, 'chat-delete', DEFAULT_PROJECT_ID, [foreign.id]),
    /不属于/,
  );
  assert.throws(
    () => assertProjectOperation(store, 'chat-delete', DEFAULT_PROJECT_ID, ['missing']),
    /不属于/,
  );
  assertProjectOperation(store, 'chat-delete', DEFAULT_PROJECT_ID, [chat.id]);
  testing.deleteSession(chat.id);
  assert.equal(testing.getSession(foreign.id).id, foreign.id);
});

test('a direct chat can propose a command through the existing execution service', async (t) => {
  const { testing } = setup(t);
  const proposals = [];
  testing.terminal = {
    info: () => ({ execution: 'background', directory: '/fixture', shell: '/bin/zsh' }),
    list: () => [],
    propose: async (projectId, input) => {
      proposals.push({ projectId, ...input });
      return { id: 'pending-command', status: 'pending' };
    },
    wait: async () => ({
      command: 'pwd',
      status: 'passed',
      exitCode: 0,
      output: '/fixture',
      error: '',
      truncated: false,
    }),
  };
  testing.fetchImpl = async (_, options) => {
    const { messages } = JSON.parse(options.body);
    const content = messages[0].content.includes('独立的工程范围与安全审查器')
      ? '{"decision":"allow"}'
      : JSON.stringify({
          answer: '已提出工程检查命令，请确认。',
          commands: [{ command: 'pwd', reason: '确认工程工作目录' }],
        });
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }),
    );
  };
  const chat = testing.createSession({});
  const result = await testing.sendMessage(chat.id, '执行命令确认当前工程工作目录', []);
  assert.deepEqual(result.messages[1].commandIds, ['pending-command']);
  assert.equal(proposals[0].sessionId, chat.id);
  assert.equal(proposals[0].command, 'pwd');
});

test('a chat executes a real background command then gives its actual output to the model before replying', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chat-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { store, testing } = setup(t);
  let commands = 0;
  let summaries = 0;
  testing.fetchImpl = async (_, options) => {
    const { messages } = JSON.parse(options.body);
    let content;
    if (messages[0].content.includes('独立的工程范围与安全审查器')) {
      const context = JSON.parse(messages[1].content);
      if (context.kind === 'command') assert.equal(context.request, '执行工程目录检查');
      content = '{"decision":"allow"}';
    } else if (messages[1].content.includes('后台命令实际执行结果')) {
      summaries++;
      assert.match(messages[1].content, /"status":"passed"/);
      assert.match(messages[1].content, /"exitCode":0/);
      assert.ok(messages[1].content.includes(root));
      content = JSON.stringify({ answer: '工程目录检查完成，命令返回成功。', commands: [] });
    } else {
      commands++;
      content = JSON.stringify({
        answer: '正在确认工程目录。',
        commands: [{ command: 'pwd', reason: '确认本工程的工作目录' }],
      });
    }
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }),
    );
  };
  const workspace = new WorkspaceService({
    store,
    settings: testing.settings,
    testing,
    fetchImpl: testing.fetchImpl,
  });
  testing.terminal = workspace.terminal = new TerminalService(workspace, { root });
  const chat = testing.createSession({});
  const result = await testing.sendMessage(chat.id, '执行工程目录检查', []);
  assert.equal(commands, 1);
  assert.equal(summaries, 1);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].content, '工程目录检查完成，命令返回成功。');
  assert.equal(
    testing.terminal.get(chat.projectId, result.messages[1].commandIds[0]).status,
    'passed',
  );
});
