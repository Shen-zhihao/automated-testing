import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analysisDraftView } from '../src/analysis-draft.mjs';
import { WorkspaceStore } from '../src/store.mjs';
import { WorkspaceService } from '../src/workspace.mjs';
import { StorageService } from '../src/storage.mjs';
import { DEFAULT_MODEL } from '../src/settings.mjs';
import { analysisReply, modelAnswer } from './analysis-fixture.mjs';

const config = { ...DEFAULT_MODEL, baseUrl: 'http://127.0.0.1:1234/v1', model: 'fixture' };
const document = {
  name: '登录需求',
  kind: 'md',
  source: '/fixture.md',
  content: '密码错误 5 次后锁定。',
};
const messagesOf = (request) => {
  const body = JSON.parse(request.body);
  return body.messages ?? body.input;
};
const catalog = JSON.stringify({
  scope: '账号登录',
  features: [{ name: '账号·锁定', requirements: '密码错误 5 次后锁定。' }],
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const until = async (condition) => {
  for (let i = 0; i < 200 && !condition(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition());
};

test('legacy and new checkpoints expose readable saved and partial sections without internal state; previous versions remain distinct', () => {
  const checkpoint = {
    fingerprint: 'private-fingerprint',
    goal: '新要求',
    steps: {
      'catalog:0': { text: catalog, complete: true, promptHash: 'private-hash' },
      'steps:F-001:0': { text: 'S-001-01 失败计数。', complete: true },
      'acceptance:F-001:0:0': {
        text: '',
        previousText: 'AC-001-01 尚未写完',
        validationError: '关联不完整',
        complete: false,
      },
    },
    previous: {
      goal: '旧要求',
      steps: { 'steps:F-001:0': { text: '旧版步骤', complete: true } },
      previous: { steps: { secret: {} } },
    },
  };
  const draft = analysisDraftView(checkpoint);
  assert.equal(draft.sections.length, 3);
  assert.equal(draft.sections[1].featureName, '账号·锁定');
  assert.equal(draft.sections[2].status, 'revising');
  assert.equal(draft.sections[2].content, 'AC-001-01 尚未写完');
  assert.equal(draft.previous.goal, '旧要求');
  assert.equal(draft.previous.previous, null);
  assert.ok(!JSON.stringify(draft).includes('private-'));
  assert.ok(!draft.sections.some((section) => section.content === '旧版步骤'));
  assert.equal(
    analysisDraftView({ goal: '', steps: { 'catalog:0': { text: '{', complete: false } } }).sections
      .length,
    0,
  );
});

test('each saved unit notifies the renderer before completion, remains readable after failure and survives reopening', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-progress-'));
  const file = path.join(root, 'workspace.sqlite');
  let store = new WorkspaceStore(file);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const doc = store.addDocument(document);
  const snapshots = [];
  let service;
  service = new WorkspaceService({
    store,
    settings: { modelConfig: async () => config },
    notify: () =>
      snapshots.push({
        job: structuredClone(service.jobs.get(doc.id)),
        draft: store.getAnalysisDraft(doc.id),
      }),
    fetchImpl: async (_, request) => {
      const messages = messagesOf(request);
      if (messages[1]?.content.includes('AC 编号从')) throw new TypeError('offline');
      return modelAnswer(analysisReply(messages));
    },
  });
  await assert.rejects(service.analyze(doc.id, '检查边界'), /已保存生成进度/);
  assert.ok(
    snapshots.some(
      ({ job, draft }) =>
        job.status === 'running' &&
        job.revision > 0 &&
        draft?.sections.some((section) => section.id.startsWith('steps:')),
    ),
  );
  assert.equal(store.getDocument(doc.id).analysis, null);
  const before = store.getAnalysisDraft(doc.id);
  assert.ok(before.sections.some((section) => section.content.includes('S-001-01')));
  store.close();
  store = new WorkspaceStore(file);
  assert.deepEqual(store.getAnalysisDraft(doc.id), before);
});

test('applying requirements during generation aborts the old request, starts a new version and holds storage/project locks until completion', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-requirements-'));
  const storage = new StorageService(root);
  const store = storage.store;
  const doc = store.addDocument(document);
  const oldWaiting = deferred(),
    newWaiting = deferred();
  let oldSignal, releaseNew, service;
  t.after(async () => {
    service?.cancelAll();
    await Promise.allSettled([...service.analysisOperations.values()]);
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  service = new WorkspaceService({
    store,
    storage,
    settings: { modelConfig: async () => config },
    fetchImpl: async (_, request) => {
      const messages = messagesOf(request);
      const prompt = messages[1]?.content ?? '';
      if (prompt.includes('S 编号从') && prompt.includes('先检查权限')) {
        oldSignal = request.signal;
        oldWaiting.resolve();
        return new Promise((_, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          }),
        );
      }
      if (prompt.includes('S 编号从') && prompt.includes('补充边界验收')) {
        newWaiting.resolve();
        return new Promise((resolve, reject) => {
          releaseNew = () => resolve(modelAnswer(analysisReply(messages)));
          request.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
        });
      }
      return modelAnswer(analysisReply(messages));
    },
  });
  const old = service.analyze(doc.id, '先检查权限').catch((error) => error);
  await oldWaiting.promise;
  await assert.rejects(service.reviseAnalysis(doc.id, 'x'.repeat(4001)), /4000/);
  assert.equal(oldSignal.aborted, false);
  await service.reviseAnalysis(doc.id, '补充边界验收');
  await newWaiting.promise;
  assert.equal(oldSignal.aborted, true);
  assert.match((await old).message, /取消/);
  assert.equal(service.jobs.get(doc.id).goal, '补充边界验收');
  assert.equal(service.jobs.get(doc.id).status, 'running');
  assert.equal(storage.activeOperations, 1);
  assert.ok(service.projectOperations.has(doc.projectId));
  await assert.rejects(storage.relocate(path.join(root, 'another')), /请等待/);
  const draft = store.getAnalysisDraft(doc.id);
  assert.equal(draft.goal, '补充边界验收');
  assert.equal(draft.previous.goal, '先检查权限');
  const operation = service.analysisOperations.get(doc.id);
  releaseNew();
  await operation;
  await until(() => storage.activeOperations === 0);
  assert.equal(store.getDocument(doc.id).analysis.goal, '补充边界验收');
  assert.equal(store.getAnalysisDraft(doc.id), null);
  assert.equal(service.projectOperations.size, 0);
});

test('closing while a revision waits for cancellation never restarts a model request', async () => {
  const store = new WorkspaceStore(':memory:');
  const doc = store.addDocument(document);
  const waiting = deferred();
  let rejectOld,
    requests = 0;
  const service = new WorkspaceService({
    store,
    settings: { modelConfig: async () => config },
    fetchImpl: async (_, request) => {
      requests++;
      const messages = messagesOf(request);
      if (messages[1]?.content.includes('S 编号从')) {
        waiting.resolve();
        return new Promise((_, reject) => {
          rejectOld = reject;
        });
      }
      return modelAnswer(analysisReply(messages));
    },
  });
  try {
    const old = service.analyze(doc.id, '旧要求').catch((error) => error);
    await waiting.promise;
    const before = requests;
    const revision = service.reviseAnalysis(doc.id, '新要求').catch((error) => error);
    service.cancelAll();
    rejectOld(new Error('cancelled'));
    assert.match((await revision).message, /已取消/);
    await old;
    assert.equal(requests, before);
    assert.equal(service.controllers.size, 0);
    assert.equal(store.getAnalysisDraft(doc.id).goal, '旧要求');
  } finally {
    store.close();
  }
});
