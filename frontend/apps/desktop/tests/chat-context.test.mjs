import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CHAT_INPUT_CHARACTERS, excerptText, messageCharacters } from '../src/context.mjs';
import { completePart } from '../src/model-client.mjs';
import { DEFAULT_MODEL } from '../src/settings.mjs';
import { answerChat } from '../src/testing/model.mjs';
import {
  chatHistory,
  buildChatContext,
  taskContext,
  commandResults,
  documentContext,
} from '../src/testing/chat-context.mjs';
import { WorkspaceStore } from '../src/store.mjs';
import { TestingService } from '../src/testing/service.mjs';
import { modelAnswer } from './analysis-fixture.mjs';

const config = { ...DEFAULT_MODEL, model: 'fixture', baseUrl: 'http://127.0.0.1:5201/v1' };
const turn = (question, answer, sourceIds = [], extra = {}) => [
  { role: 'user', content: question, sourceIds, status: 'complete' },
  { role: 'assistant', content: answer, sourceIds, status: 'complete', ...extra },
];
const current = (content, sourceIds = []) => ({
  role: 'user',
  content,
  sourceIds,
  status: 'complete',
});
const longHistory = () =>
  Array.from({ length: 30 }, (_, index) =>
    turn(`第${index}轮讨论功能${index}。` + '历史问题。'.repeat(200), '历史回复。'.repeat(600)),
  ).flat();

for (const format of ['chat-completions', 'responses']) {
  test(`${format}: five large documents, long history, tasks and logs share one budget including both reviews`, async () => {
    const sources = Array.from({ length: 5 }, (_, index) => ({
      id: `source-${index}`,
      name: `文档${index}`,
      analysisCreatedAt: '2026-10-22',
      content: '无关背景资料\n'.repeat(12000) + `唯一尾部规则 DOC_${index}_TAIL：失败后保留数据。`,
      analysis: '普通分析\n'.repeat(12000) + `AC-${index}-01 唯一尾部规则：失败后保留数据。`,
    }));
    const question =
      '说明要求。'.repeat(2300) + '请比较5份文档的唯一尾部规则，失败后如何保留数据？';
    const session = {
      messages: [
        ...longHistory(),
        current(
          question,
          sources.map((item) => item.id),
        ),
      ],
      taskContext: { name: '关联任务', scope: '保留数据', notes: [], cases: [] },
      commandContext: { execution: 'background', directory: '/fixture', recentCommands: [] },
      commandResults: [0, 1, 2].map((index) => ({
        command: `pnpm test${index}`,
        status: 'failed',
        exitCode: 1,
        output: `ERROR_START_${index}\n` + '命令输出\n'.repeat(15000) + `ERROR_END_${index}`,
        error: '',
      })),
    };
    const before = structuredClone(session);
    const requests = [];
    const fullAnswer = '根据已提供的资料进行测试设计。'.repeat(1800) + '最终结论：尚未执行测试。';
    const result = await answerChat(
      {
        references: sources,
        project: { name: '测试工程' },
        projectDocuments: Array.from({ length: 500 }, (_, index) => ({
          name: `资料${index}`,
          analyzed: true,
        })),
      },
      session,
      { ...config, format },
      {
        fetchImpl: async (_, request) => {
          const body = JSON.parse(request.body);
          const messages = body.messages ?? body.input;
          requests.push(messages);
          assert.ok(messageCharacters(messages) <= CHAT_INPUT_CHARACTERS);
          const review = messages[0].content.includes('独立的工程范围与安全审查器');
          if (review) {
            const payload = JSON.parse(messages[1].content);
            assert.equal(payload.request, question);
            if (payload.kind === 'response') assert.equal(payload.response, fullAnswer);
            return modelAnswer('{"decision":"allow"}', 'stop', format);
          }
          assert.equal(messages.at(-1).content, question);
          assert.equal(messages.filter((message) => message.content === question).length, 1);
          for (let index = 0; index < 5; index++)
            assert.match(messages[1].content, new RegExp(`DOC_${index}_TAIL`));
          return modelAnswer(fullAnswer, 'stop', format);
        },
      },
    );
    assert.equal(requests.length, 3); // 本机选择上下文，不额外调用模型压缩历史。
    assert.equal(result.contextUsage.documents, 5);
    assert.ok(result.contextUsage.omittedTurns > 0);
    for (const excerpt of result.excerpts) assert.ok(requests[1][1].content.includes(excerpt.text));
    for (let index = 0; index < 5; index++)
      assert.ok(result.excerpts.some((item) => item.id.startsWith(`D${index + 1}-P-`)));
    assert.deepEqual(session, before);
  });
}

test('history retains complete recent turns, recalls early user constraints and excludes failed, refused and orphaned turns', () => {
  const messages = [
    ...turn('数据库必须用 SQLite，禁止引入远程数据库。', '建议采用本机数据库。', ['old-version']),
    ...turn('FAILED_REQUEST_MUST_NOT_RETURN', 'FAILED_ANSWER', [], { status: 'error' }),
    ...turn('REFUSED_REQUEST_MUST_NOT_RETURN', 'REFUSED_ANSWER', [], { refused: true }),
    { role: 'assistant', content: 'ORPHAN_ANSWER', status: 'complete' },
    ...longHistory(),
    ...turn('更正：SQLite 数据库保存到用户选择的本机目录。', '此前目录建议作废。', ['new-version']),
    current('现在确认数据库方案及保存位置。', ['new-version']),
  ];
  const original = structuredClone(messages);
  const result = chatHistory(messages, ['new-version']);
  assert.match(result.memory, /数据库必须用 SQLite/);
  assert.match(result.memory, /助手历史回复（不等于已采纳事实）/);
  assert.match(result.memory, /旧快照/);
  assert.equal(result.messages.at(-2).content, messages.at(-3).content);
  assert.equal(result.messages.at(-1).content, '此前目录建议作废。');
  assert.equal(result.usage.referenceChanged, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /FAILED_REQUEST|FAILED_ANSWER|REFUSED_REQUEST|REFUSED_ANSWER|ORPHAN_ANSWER/,
  );
  for (let index = 0; index < result.messages.length; index += 2) {
    assert.equal(result.messages[index].role, 'user');
    assert.equal(result.messages[index + 1].role, 'assistant');
  }
  assert.deepEqual(messages, original);
});

test('short follow-ups retrieve the prior user topic and prefer the current question over a previous unrelated topic', () => {
  const source = {
    id: 'new-version',
    name: '需求',
    content: '无关介绍\n'.repeat(1000) + '退款恢复：失败后允许再次提交。',
    analysis: '',
  };
  const result = buildChatContext(
    { references: [source] },
    {
      messages: [...turn('退款恢复在失败后应怎样处理？', '需要核对当前需求。'), current('继续')],
      sourceId: 'different-version',
      featureId: 'F-999',
    },
    '工程助手',
  );
  assert.match(result.messages[1].content, /退款恢复：失败后允许再次提交/);
  assert.match(result.messages[1].content, /讨论功能：整份文档/);
  const context = documentContext(
    { ...source, content: '上传旧话题\n'.repeat(1500) + '当前独有登录规则：验证登录锁定。' },
    '登录锁定\n' + '上传旧话题'.repeat(300),
    '',
    '',
    1000,
    '登录锁定',
  );
  assert.ok(context.excerpts.some((item) => item.text.includes('当前独有登录规则')));
  const numbered = documentContext(
    {
      id: 'numbered',
      name: '长文档',
      analysis: '',
      content: '背'.repeat(4000 * 24) + '原文末尾独有数值：五次。',
    },
    '核对 D2-P-025',
    '',
    'D2-',
    1200,
  );
  assert.ok(numbered.excerpts.some((item) => item.id === 'D2-P-025' && item.text.includes('五次')));
});

test('removing a reference sends no cached document body and identifies historical versions as background', () => {
  const result = buildChatContext(
    {
      references: [],
      project: { name: '当前工程' },
      projectDocuments: [{ name: '旧需求文档', analyzed: true }],
    },
    {
      messages: [
        ...turn('此前 F-001 如何验收？', '依据旧版本 P-001 的建议。', ['removed-snapshot']),
        current('现在只讨论工程计划。'),
      ],
    },
    '工程助手',
  );
  assert.match(result.messages[1].content, /本轮未引用文档/);
  assert.match(result.messages[1].content, /历史引用与本轮不同/);
  assert.deepEqual(result.excerpts, []);
  assert.equal(result.usage.documents, 0);
});

test('task context selects a tail case and retained conclusion as valid JSON instead of cutting a case array', () => {
  const cases = Array.from({ length: 100 }, (_, index) => ({
    id: `TC-${String(index + 1).padStart(3, '0')}`,
    title: `场景${index + 1}`,
    requirement: `AC-001-${index + 1}`,
    steps: ['检查状态'],
    expected: ['显示结果'],
  }));
  const notes = Array.from({ length: 80 }, (_, index) => ({
    id: `note-${index}`,
    content: index === 79 ? 'TC-100 特别约束：保留失败数据。' : '其他讨论内容。'.repeat(100),
  }));
  const context = taskContext(
    { name: '测试任务', scope: '所有功能', cases, notes, sourceId: 'snapshot', reportStale: true },
    'TC-100 失败数据',
  );
  assert.ok(context.length <= 3000);
  const parsed = JSON.parse(context);
  assert.ok(parsed.cases.some((item) => item.id === 'TC-100'));
  assert.ok(parsed.notes.some((item) => item.id === 'note-79'));
  assert.equal(parsed.reportStale, true);
  assert.ok(parsed.omittedCases > 0);
  assert.ok(parsed.omittedNotes > 0);
});

test('actual command results retain status, command, beginning and tail while preserving JSON and the shared allowance', () => {
  const runs = [0, 1, 2].map((index) => ({
    command: 'pnpm ' + 'test'.repeat(490),
    status: 'failed',
    exitCode: index + 1,
    output: `FIRST_FAILURE_${index}\n` + '"\\日志\n'.repeat(20000) + `\nFINAL_FAILURE_${index}`,
    error: '错误摘要'.repeat(100),
  }));
  const result = commandResults(runs);
  assert.ok(result.length <= 9000);
  const parsed = JSON.parse(result);
  for (let index = 0; index < 3; index++) {
    assert.equal(parsed[index].status, 'failed');
    assert.equal(parsed[index].exitCode, index + 1);
    assert.equal(parsed[index].command, runs[index].command);
    assert.equal(parsed[index].truncated, true);
    assert.match(parsed[index].output, new RegExp(`FIRST_FAILURE_${index}`));
    assert.match(parsed[index].output, new RegExp(`FINAL_FAILURE_${index}`));
  }
});

test('context excerpts preserve Unicode boundaries and disclose omission', () => {
  const text = '开始😀\n'.repeat(500) + '唯一登录约束：连续失败五次锁定😀';
  for (let budget = 0; budget < 400; budget++) {
    for (const query of ['', '唯一登录约束']) {
      const result = excerptText(text, budget, query);
      assert.ok(result.length <= budget);
      assert.ok(result.isWellFormed());
      if (budget > 200) assert.match(result, /上下文节选/);
    }
  }
  assert.match(excerptText(text, 300, '唯一登录约束'), /连续失败五次锁定/);
  const paragraph = '背景'.repeat(1000) + '唯一锁定阈值为五次。' + '背景'.repeat(1000);
  assert.match(excerptText(paragraph, 300, '唯一锁定阈值'), /唯一锁定阈值为五次/);
});

test('an oversized request is rejected before sending, and an oversized escaped answer cannot pass a partial response review', async () => {
  let calls = 0;
  await assert.rejects(
    completePart(config, [{ role: 'user', content: '字'.repeat(50000) }], {
      inputCharacterLimit: CHAT_INPUT_CHARACTERS,
      fetchImpl: async () => {
        calls++;
        return modelAnswer('OK');
      },
    }),
    /超过本机请求预算/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    answerChat({ references: [] }, { messages: [current('请分析工程约束。')] }, config, {
      fetchImpl: async (_, request) => {
        calls++;
        const body = JSON.parse(request.body);
        return modelAnswer(
          body.messages[0].content.includes('独立的工程范围与安全审查器')
            ? '{"decision":"allow"}'
            : '\\'.repeat(31000),
        );
      },
    }),
    /无法完整审查/,
  );
  assert.equal(calls, 2);
});

test('restart rebuilds relevant history locally and persists usage without rewriting or deleting the full conversation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chat-context-'));
  const file = path.join(root, 'workspace.sqlite');
  let store = new WorkspaceStore(file),
    service;
  t.after(async () => {
    service?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  service = new TestingService({ store, settings: {} });
  const created = service.createSession({});
  const original = [...turn('必须保留 SQLite 数据库。', '使用本机数据库。'), ...longHistory()];
  service.db.saveSession({ ...service.db.session(created.id), messages: original });
  service.close();
  store.close();
  store = new WorkspaceStore(file);
  const requests = [];
  service = new TestingService({
    store,
    settings: { modelConfig: async () => config },
    fetchImpl: async (_, request) => {
      const messages = JSON.parse(request.body).messages;
      requests.push(messages);
      return modelAnswer(
        messages[0].content.includes('独立的工程范围与安全审查器')
          ? '{"decision":"allow"}'
          : '继续采用本机 SQLite，具体规则待核对。',
      );
    },
  });
  const result = await service.sendMessage(created.id, '继续确认数据库约束。', []);
  assert.equal(requests.length, 3);
  assert.match(requests[1][1].content, /必须保留 SQLite 数据库/);
  assert.ok(result.messages.at(-1).contextUsage.recalledTurns > 0);
  assert.equal(result.messages.length, original.length + 2);
  assert.deepEqual(service.db.session(created.id).messages.slice(0, original.length), original);
  assert.equal(
    service.db.session(created.id).messages.at(-1).contextUsage.omittedTurns,
    result.messages.at(-1).contextUsage.omittedTurns,
  );
});
