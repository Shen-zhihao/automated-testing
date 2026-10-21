import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyzeDocument, reviewAgentScope } from '../src/model.mjs';
import { completePart } from '../src/model-client.mjs';
import { createAnalysisWriter, splitText } from '../src/analysis-text.mjs';
import { WorkspaceService } from '../src/workspace.mjs';
import { WorkspaceStore } from '../src/store.mjs';
import { DEFAULT_MODEL } from '../src/settings.mjs';
import { analysisReply, modelAnswer } from './analysis-fixture.mjs';

const config = {
  ...DEFAULT_MODEL,
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'fixture',
  apiKey: 'fixture-secret',
};
const document = {
  name: '锁定规则',
  kind: 'md',
  source: '/fixture.md',
  content: '密码错误 5 次后锁定。',
};
const messagesOf = (request) => {
  const body = JSON.parse(request.body);
  return body.messages ?? body.input;
};
const anchorOf = (messages) => JSON.parse(messages.at(-1).content.split('锚点：').at(-1));
const optionsFor = (fetchImpl, extra = {}) => ({ onProgress: () => {}, fetchImpl, ...extra });

for (const format of ['chat-completions', 'responses']) {
  test(`${format}: Feishu images and old image progress never block or enter text analysis`, async () => {
    const imageOnlyText = '图片内容不应发送给模型';
    const result = await analyzeDocument(
      {
        ...document,
        kind: 'feishu',
        preview: {
          format: 'html',
          content: `<img src="data:image/png;base64,unreadable" alt="${imageOnlyText}">`,
        },
        warnings: ['图片读取失败，正文已保留。'],
      },
      '',
      { ...config, format },
      {
        checkpoint: {
          goal: '',
          steps: {},
          imageRecognition: { images: [{ texts: [imageOnlyText] }] },
          imageReconciliation: { duplicates: [{ evidence: '正文中不存在的去重依据' }] },
        },
        fetchImpl: async (_, request) => {
          const messages = messagesOf(request);
          assert.ok(messages.every((message) => typeof message.content === 'string'));
          assert.ok(!request.body.includes('data:image/'));
          assert.ok(!request.body.includes(imageOnlyText));
          assert.ok(!request.body.includes('正文中不存在的去重依据'));
          return modelAnswer(analysisReply(messages), 'stop', format);
        },
      },
    );
    assert.equal(result.kind, 'implementation-plan');
    assert.match(result.content, /AC-001-01/);
  });
}

for (const format of ['chat-completions', 'responses']) {
  test(`${format}: truncated JSON and Markdown continue without discarding the prefix or repeating sections`, async () => {
    let catalogTail,
      stepsTail,
      catalogCuts = 0,
      stepsCuts = 0;
    const snapshots = [],
      calls = [];
    const result = await analyzeDocument(
      document,
      '',
      { ...config, format },
      {
        onCheckpoint: (value) => snapshots.push(structuredClone(value)),
        fetchImpl: async (_, request) => {
          const messages = messagesOf(request);
          calls.push(messages);
          assert.ok(messages.reduce((n, message) => n + message.content.length, 0) <= 48000);
          if (messages.length > 2) {
            const anchor = anchorOf(messages);
            const tail = messages[1].content.includes('仅输出 JSON') ? catalogTail : stepsTail;
            assert.ok(messages.at(-2).content.length <= 3000);
            return modelAnswer(anchor + tail, 'stop', format);
          }
          const reply = analysisReply(messages);
          if (messages[1]?.content.includes('仅输出 JSON') && !catalogCuts++) {
            catalogTail = reply.slice(-18);
            return modelAnswer(reply.slice(0, -18), 'length', format);
          }
          if (messages[1]?.content.includes('S 编号从') && !stepsCuts++) {
            stepsTail = reply.slice(-9);
            return modelAnswer(reply.slice(0, -9), 'length', format);
          }
          return modelAnswer(reply, 'stop', format);
        },
      },
    );
    assert.match(result.content, /S-001-01/);
    assert.match(result.content, /AC-001-01/);
    assert.equal((result.content.match(/## 功能实现步骤/g) || []).length, 1);
    assert.ok(
      snapshots.some((state) =>
        Object.values(state.steps).some((step) => !step.complete && step.text),
      ),
    );
    assert.equal(calls.filter((messages) => messages.length > 2).length, 2);
    assert.ok(!JSON.stringify(snapshots).includes(config.apiKey));
  });
}

test('continuation preserves whitespace, table boundaries and a long prefix while sending only the tail', async () => {
  const prefix = '说明。'.repeat(4000) + '\n\n| 条件 | 结果 |\n| --- | --- |\n| a | ';
  const suffix = 'b |\n';
  const state = { steps: {} };
  let requests = 0;
  const writer = createAnalysisWriter(
    config,
    state,
    optionsFor(async (_, request) => {
      const messages = messagesOf(request);
      if (++requests === 1) return modelAnswer(prefix, 'length');
      assert.equal(messages.at(-2).content.length, 3000);
      assert.ok(!messages.at(-2).content.includes(prefix));
      return modelAnswer(anchorOf(messages) + suffix);
    }),
  );
  assert.equal(await writer('test', '表格', '生成表格。'), prefix + suffix);
  assert.equal(state.steps.test.complete, true);
});

test('model subheadings become nested report headings while code examples and semantic checks stay intact', async () => {
  const fetchImpl = async (_, request) => {
    const messages = messagesOf(request);
    const reply = analysisReply(messages);
    if (messages[1]?.content.includes('S 编号从'))
      return modelAnswer(`# 目标与约束\n\n## 实现步骤\n\n${reply}\n\n\`\`\`md\n# 示例内容\n\`\`\``);
    if (messages[1]?.content.includes('AC 编号从')) return modelAnswer(`## 验收标准\n\n${reply}`);
    return modelAnswer(reply);
  };
  const result = await analyzeDocument(document, '', config, { fetchImpl });
  assert.match(result.content, /#### 目标与约束/);
  assert.match(result.content, /##### 实现步骤/);
  assert.match(result.content, /##### 验收标准/);
  assert.match(result.content, /```md\n# 示例内容\n```/);
  assert.equal((result.content.match(/^## 功能实现步骤$/gm) || []).length, 1);
  assert.equal((result.content.match(/^## 功能验收标准$/gm) || []).length, 1);
  await assert.rejects(
    analyzeDocument(document, '', config, {
      fetchImpl: async (_, request) => {
        const messages = messagesOf(request);
        const reply = analysisReply(messages);
        return modelAnswer(
          messages[1]?.content.includes('AC 编号从')
            ? `## 验收标准\n\n${reply.replaceAll('S-001-01', 'S-999-01')}`
            : reply,
        );
      },
    }),
    /功能验收标准或步骤关联/,
  );
});

test('bounded automatic continuation keeps a resumable partial draft instead of looping indefinitely', async () => {
  const state = { steps: {} };
  let requests = 0,
    saved;
  const fetchImpl = async (_, request) => {
    const messages = messagesOf(request);
    return modelAnswer(
      (messages.length > 2 ? anchorOf(messages) : '') + `片段 ${++requests}\n`,
      'length',
    );
  };
  const writer = createAnalysisWriter(
    config,
    state,
    optionsFor(fetchImpl, {
      onCheckpoint: (value) => {
        saved = structuredClone(value);
      },
    }),
  );
  await assert.rejects(writer('long', '长段', '只写当前段。'), /连续续写 12 次/);
  assert.equal(requests, 12);
  assert.equal(saved.steps.long.complete, false);
  const resumed = createAnalysisWriter(
    config,
    saved,
    optionsFor(async (_, request) => modelAnswer(anchorOf(messagesOf(request)) + '末尾完成。')),
  );
  assert.match(await resumed('long', '长段', '只写当前段。'), /片段 12\n末尾完成。$/);
});

test('invalid acceptance is repaired with precise feedback without regenerating completed work', async () => {
  const calls = [],
    snapshots = [],
    progress = [];
  let acceptanceCalls = 0;
  const result = await analyzeDocument(document, '', config, {
    onProgress: (message) => progress.push(message),
    onCheckpoint: (value) => snapshots.push(structuredClone(value)),
    fetchImpl: async (_, request) => {
      const messages = messagesOf(request);
      const prompt = messages[1]?.content ?? '';
      calls.push(prompt);
      const reply = analysisReply(messages);
      if (prompt.includes('AC 编号从')) {
        if (!acceptanceCalls++) return modelAnswer(reply.replaceAll('S-001-01', 'S-999-01'));
        assert.match(prompt, /缺少关联：S-001-01/);
        assert.match(prompt, /引用了未提供的步骤：S-999-01/);
        assert.match(prompt, /此前未通过的正文已作废/);
      }
      return modelAnswer(reply);
    },
  });
  assert.equal(acceptanceCalls, 2);
  assert.equal(calls.filter((prompt) => prompt.includes('仅输出 JSON')).length, 1);
  assert.equal(calls.filter((prompt) => prompt.includes('S 编号从')).length, 1);
  assert.ok(progress.some((message) => message.includes('正在修正输出')));
  const invalid = snapshots.find((s) => s.steps['acceptance:F-001:0:0']?.validationError);
  assert.equal(invalid.steps['acceptance:F-001:0:0'].text, '');
  assert.equal(invalid.steps['steps:F-001:0'].complete, true);
  assert.match(result.content, /AC-001-01/);
  assert.ok(!result.content.includes('S-999-01'));
});

test('correction is bounded, retains its feedback across restart and preserves completed steps and old reports', async () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const doc = store.addDocument(document);
    store.saveAnalysis(doc.id, { content: '上次成功报告' });
    let attempts = 0;
    const first = new WorkspaceService({
      store,
      settings: { modelConfig: async () => config },
      fetchImpl: async (_, request) => {
        const messages = messagesOf(request);
        const reply = analysisReply(messages);
        if (messages[1]?.content.includes('AC 编号从')) {
          attempts++;
          return modelAnswer(reply.replaceAll('S-001-01', 'S-999-01'));
        }
        return modelAnswer(reply);
      },
    });
    await assert.rejects(first.analyze(doc.id, ''), /缺少关联：S-001-01/);
    assert.equal(attempts, 3);
    assert.equal(store.getDocument(doc.id).analysis.content, '上次成功报告');
    const state = store.readAnalysisCheckpoint(doc.id);
    assert.equal(state.steps['steps:F-001:0'].complete, true);
    assert.match(state.steps['acceptance:F-001:0:0'].validationError, /缺少关联/);
    const second = new WorkspaceService({
      store,
      settings: { modelConfig: async () => config },
      fetchImpl: async (_, request) => {
        const messages = messagesOf(request);
        if (!messages[0]?.content.includes('独立的工程范围与安全审查器')) {
          assert.match(messages[1].content, /本机校验反馈/);
          assert.match(messages[1].content, /缺少关联：S-001-01/);
        }
        return modelAnswer(analysisReply(messages));
      },
    });
    await second.analyze(doc.id, '');
    assert.equal(store.getDocument(doc.id).analysis.kind, 'implementation-plan');
    assert.equal(store.readAnalysisCheckpoint(doc.id), null);
  } finally {
    store.close();
  }
});

test('failed continuation rewrites only the current unit; refusal and non-token incomplete responses remain failures', async () => {
  for (const response of ['完全重新开始。', '仅重复锚点']) {
    const state = { steps: {} };
    let requests = 0;
    const writer = createAnalysisWriter(
      config,
      state,
      optionsFor(async (_, request) => {
        if (++requests === 1) return modelAnswer('已保留的正文。', 'length');
        const messages = messagesOf(request);
        if (messages.length > 2)
          return modelAnswer(response === '仅重复锚点' ? anchorOf(messages) : response);
        assert.match(messages[1].content, /完整重写当前段/);
        return modelAnswer('完整重写后的正文。');
      }),
    );
    assert.equal(await writer('bad', '续写', '编写正文'), '完整重写后的正文。');
    assert.equal(state.steps.bad.complete, true);
    assert.equal(state.steps.bad.previousText, undefined);
  }
  for (const data of [
    { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] },
    { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'refused' }] }] },
    { status: 'failed', error: { message: 'bad' } },
    { status: 'in_progress', output: [{ content: [{ type: 'output_text', text: 'partial' }] }] },
  ])
    await assert.rejects(
      completePart({ ...config, format: 'responses' }, [], {
        fetchImpl: async () => new Response(JSON.stringify(data)),
      }),
    );
  await assert.rejects(
    completePart(config, [], { fetchImpl: async () => modelAnswer('', 'length') }),
    /没有返回正文/,
  );
  await assert.rejects(
    completePart(config, [], { fetchImpl: async () => modelAnswer('partial', 'aborted') }),
    /中断/,
  );
});

test('scope review honors the configured output allowance so reasoning models are not capped at 1024', async () => {
  let budget;
  const result = await reviewAgentScope(
    { ...config, maxTokens: 32768 },
    { kind: 'request', request: '分析工程需求' },
    {
      fetchImpl: async (_, request) => {
        budget = JSON.parse(request.body).max_tokens;
        return modelAnswer('{"decision":"allow"}');
      },
    },
  );
  assert.equal(budget, 32768);
  assert.equal(result, 'allow');
});

test('failed final save atomically preserves the old success and the resumable draft', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const doc = store.addDocument(document);
    store.saveAnalysis(doc.id, { content: '旧结果' });
    store.saveAnalysisCheckpoint(doc.id, { goal: '', steps: {} });
    store.db.exec(
      "CREATE TRIGGER fail_checkpoint_delete BEFORE DELETE ON analysis_checkpoints BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;",
    );
    assert.throws(() => store.saveAnalysis(doc.id, { content: '新结果' }), /fixture disk failure/);
    assert.equal(store.getDocument(doc.id).analysis.content, '旧结果');
    assert.ok(store.readAnalysisCheckpoint(doc.id));
  } finally {
    store.close();
  }
});

test('restart resumes completed work, tolerates a larger output budget, preserves old success on failure and clears a finished draft', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'analysis-resume-'));
  const file = path.join(dir, 'workspace.sqlite');
  let store = new WorkspaceStore(file);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const doc = store.addDocument(document);
  store.saveAnalysis(doc.id, { content: '原有成功报告', goal: '边界' });
  let savedConfig = { ...config };
  const createService = (fetchImpl) =>
    new WorkspaceService({ store, settings: { modelConfig: async () => savedConfig }, fetchImpl });
  const firstCalls = [],
    resumedCalls = [];
  const first = createService(async (_, request) => {
    const messages = messagesOf(request);
    firstCalls.push(messages[1]?.content);
    if (messages[1]?.content.includes('AC 编号从')) throw new TypeError('offline');
    return modelAnswer(analysisReply(messages));
  });
  await assert.rejects(first.analyze(doc.id, '边界'), /已保存生成进度/);
  assert.equal(store.getDocument(doc.id).analysis.content, '原有成功报告');
  assert.deepEqual(store.getDocument(doc.id).analysisDraft, { goal: '边界' });
  assert.equal(Object.keys(store.readAnalysisCheckpoint(doc.id).steps).length, 2);
  assert.ok(!JSON.stringify(store.readAnalysisCheckpoint(doc.id)).includes(config.apiKey));
  store.close();
  store = new WorkspaceStore(file);
  savedConfig = { ...config, maxTokens: 8192 };
  const second = createService(async (_, request) => {
    const messages = messagesOf(request);
    resumedCalls.push(messages[1]?.content);
    return modelAnswer(analysisReply(messages));
  });
  await second.analyze(doc.id, '边界');
  assert.ok(firstCalls.some((text) => text.includes('仅输出 JSON')));
  assert.ok(
    !resumedCalls.some((text) => text.includes('仅输出 JSON') || text.includes('S 编号从')),
  );
  assert.match(store.getDocument(doc.id).analysis.content, /AC-001-01/);
  assert.equal(store.readAnalysisCheckpoint(doc.id), null);
  assert.equal(store.getDocument(doc.id).analysisDraft, null);
});

test('cancellation in a continuation retains the partial step and resumes it after retry', async () => {
  const store = new WorkspaceStore(':memory:');
  const doc = store.addDocument(document);
  let tail,
    cancelled = false;
  const service = new WorkspaceService({
    store,
    settings: { modelConfig: async () => config },
    fetchImpl: async (_, request) => {
      const messages = messagesOf(request);
      if (messages.length > 2) {
        if (!cancelled) {
          cancelled = true;
          service.cancel(doc.id);
          request.signal.throwIfAborted();
        }
        return modelAnswer(anchorOf(messages) + tail);
      }
      const reply = analysisReply(messages);
      if (messages[1]?.content.includes('S 编号从')) {
        tail = reply.slice(-10);
        return modelAnswer(reply.slice(0, -10), 'length');
      }
      return modelAnswer(reply);
    },
  });
  try {
    await assert.rejects(service.analyze(doc.id, ''), /取消.*已保存生成进度/);
    assert.equal(store.getDocument(doc.id).analysis, null);
    assert.ok(
      Object.values(store.readAnalysisCheckpoint(doc.id).steps).some(
        (step) => !step.complete && step.text,
      ),
    );
    await service.analyze(doc.id, '');
    assert.equal(store.getDocument(doc.id).analysis.kind, 'implementation-plan');
  } finally {
    store.close();
  }
});

test('goal, source and model changes invalidate cached work; unchanged text keeps the draft and removal cascades it', async () => {
  let checkpoint;
  const firstFetch = async (_, request) => {
    const messages = messagesOf(request);
    if (messages[1]?.content.includes('AC 编号从')) throw new TypeError('offline');
    return modelAnswer(analysisReply(messages));
  };
  await assert.rejects(
    analyzeDocument(document, '', config, {
      fetchImpl: firstFetch,
      onCheckpoint: (value) => {
        checkpoint = structuredClone(value);
      },
    }),
  );
  for (const [doc, goal, settings] of [
    [document, '增加边界检查', config],
    [{ ...document, content: document.content + '新规则' }, '', config],
    [document, '', { ...config, model: 'other-model' }],
    [document, '', { ...config, baseUrl: 'https://other.example/v1' }],
  ]) {
    let catalogs = 0;
    await analyzeDocument(doc, goal, settings, {
      checkpoint,
      fetchImpl: async (_, request) => {
        const messages = messagesOf(request);
        if (messages[1]?.content.includes('仅输出 JSON')) catalogs++;
        return modelAnswer(analysisReply(messages));
      },
    });
    assert.equal(catalogs, 1);
  }
  const store = new WorkspaceStore(':memory:');
  try {
    const doc = store.addDocument(document);
    store.saveAnalysisCheckpoint(doc.id, checkpoint);
    store.updateDocumentSource(doc.id, {
      content: document.content,
      preview: { format: 'text', content: '新格式' },
    });
    assert.ok(store.readAnalysisCheckpoint(doc.id));
    store.updateDocumentSource(doc.id, { content: '新原文' });
    assert.equal(store.readAnalysisCheckpoint(doc.id), null);
    store.saveAnalysisCheckpoint(doc.id, checkpoint);
    store.deleteDocument(doc.id);
    assert.equal(store.readAnalysisCheckpoint(doc.id), null);
  } finally {
    store.close();
  }
});

test('segmentation preserves every character, including surrogate pairs and the final unique requirement', () => {
  const text = '甲'.repeat(5999) + '😀\n' + '乙'.repeat(18000) + '\n末尾独有规则';
  const chunks = splitText(text, 6000);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 6000 && !/[\uD800-\uDBFF]$/.test(chunk)));
  assert.match(chunks.at(-1), /末尾独有规则$/);
});
