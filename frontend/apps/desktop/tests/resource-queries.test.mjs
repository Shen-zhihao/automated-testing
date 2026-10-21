import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStore } from '../src/store.mjs';
import { TestingStore } from '../src/testing/store.mjs';
import { TerminalService } from '../src/terminal/service.mjs';
import { WorkspaceService } from '../src/workspace.mjs';
import { DEFAULT_PROJECT_ID } from '../src/projects.mjs';

test('a populated v7 database upgrades once and keeps documents, secrets, histories and metadata current', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resource-index-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fixture.sqlite');
  let store = new WorkspaceStore(file);
  const document = store.addDocument({
    name: '需求',
    source: '/fixture.md',
    kind: 'md',
    content: '旧正文🚀',
    preview: { format: 'html', content: '<p>旧正文</p>' },
  });
  store.saveAnalysis(document.id, { content: '保留分析' });
  store.writeSettings({ apiKey: 'synthetic-encrypted-value' });
  new TestingStore(store).saveSession({
    id: 'history',
    projectId: DEFAULT_PROJECT_ID,
    title: '历史讨论',
    sourceId: 'source',
    updatedAt: '2026',
    messages: [{ content: '完整历史' }],
  });
  store.db.exec(`DROP INDEX documents_summary; DROP INDEX test_sessions_summary;
    DROP INDEX test_runs_summary; DROP INDEX test_runs_status;
    CREATE INDEX test_runs_task ON test_runs(task_id, created_at);
    DROP INDEX command_runs_status; PRAGMA user_version=7;`);
  store.close();
  store = new WorkspaceStore(file);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 8);
  assert.equal(store.readSettings().apiKey, 'synthetic-encrypted-value');
  assert.equal(store.getDocument(document.id).analysis.content, '保留分析');
  assert.equal(store.projects.list()[0].analyzedCount, 1);
  assert.equal(new TestingStore(store).session('history').messages[0].content, '完整历史');
  const content = '新正文与边界🚀🚀';
  store.updateDocumentSource(document.id, { content });
  assert.equal(store.listDocuments()[0].characters, [...content].length);
  assert.equal(store.listDocuments()[0].analyzed, false);
  assert.equal(store.projects.list()[0].analyzedCount, 0);
  store.close();
  store = new WorkspaceStore(file);
  t.after(() => store.close());
  assert.equal(store.getDocument(document.id).content, content);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
});

test('summary reads use covering indexes and startup recovery uses a status lookup', (t) => {
  const store = new WorkspaceStore(':memory:');
  t.after(() => store.close());
  const prepare = store.db.prepare.bind(store.db),
    queries = [];
  store.db.prepare = (sql) => {
    queries.push(sql);
    return prepare(sql);
  };
  store.listDocuments();
  new TestingStore(store).sessionSummaries();
  new TerminalService({ store, notify() {} }, { root: os.tmpdir() });
  for (const [fragment, index, parameters] of [
    ['FROM documents WHERE project_id', 'documents_summary', [DEFAULT_PROJECT_ID]],
    ['FROM test_sessions WHERE', 'test_sessions_summary', [DEFAULT_PROJECT_ID]],
    ["IN ('running', 'reviewing')", 'command_runs_status', []],
  ]) {
    const sql = queries.find((value) => value.includes(fragment));
    assert.ok(sql, fragment);
    const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...parameters)
      .map((row) => row.detail)
      .join('\n');
    assert.match(plan, new RegExp(index));
    assert.doesNotMatch(plan, /TEMP B-TREE/);
    if (index.endsWith('summary')) assert.match(plan, /COVERING INDEX/);
  }
});

test('command previews cross into JavaScript already bounded while detail retains complete Unicode output', (t) => {
  const store = new WorkspaceStore(':memory:');
  t.after(() => store.close());
  const output = '最初原始日志标记' + '旧日志'.repeat(40000) + '🚀'.repeat(300);
  const terminal = new TerminalService({ store, notify() {} }, { root: os.tmpdir() });
  terminal.save({
    id: 'long-run',
    projectId: DEFAULT_PROJECT_ID,
    createdAt: '2026',
    status: 'passed',
    output,
    fingerprint: 'internal-only',
    command: 'echo fixture',
    exitCode: 0,
  });
  const prepare = store.db.prepare.bind(store.db);
  let transferred = '';
  store.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!sql.includes('FROM command_runs WHERE project_id=')) return statement;
    return {
      all: (...args) => {
        const rows = statement.all(...args);
        transferred = rows[0].data;
        return rows;
      },
    };
  };
  const run = terminal.list(DEFAULT_PROJECT_ID)[0];
  assert.equal(run.output, output.slice(-500));
  assert.equal(run.fingerprint, undefined);
  assert.ok(transferred.length < 2000);
  assert.ok(!transferred.includes('最初原始日志标记'));
  assert.equal(terminal.publicRun(DEFAULT_PROJECT_ID, 'long-run').output, output);
});

test('global pages read no project contents while existing default and explicit project calls stay compatible', (t) => {
  const store = new WorkspaceStore(':memory:');
  t.after(() => store.close());
  const document = store.addDocument({
    name: '需求',
    source: '/fixture',
    kind: 'txt',
    content: '保留正文',
  });
  const workspace = new WorkspaceService({
    store,
    settings: { public: () => ({ configured: true }) },
    feishu: { status: () => ({ connected: false }) },
  });
  assert.equal(workspace.snapshot().documents[0].id, document.id);
  assert.equal(workspace.snapshot(DEFAULT_PROJECT_ID).documents[0].id, document.id);
  store.listDocuments = () => assert.fail('global pages must not query project documents');
  workspace.testing = {
    snapshot: () => assert.fail('global pages must not query conversations or tasks'),
  };
  const snapshot = workspace.snapshot(null);
  assert.equal(snapshot.activeProjectId, null);
  assert.equal(snapshot.projects[0].documentCount, 1);
  assert.equal(snapshot.settings.configured, true);
  assert.deepEqual(snapshot.documents, []);
  assert.deepEqual(snapshot.testSessions, []);
  assert.deepEqual(snapshot.testTasks, []);
});
