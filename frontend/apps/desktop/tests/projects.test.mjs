import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStore } from '../src/store.mjs';
import { WorkspaceService } from '../src/workspace.mjs';
import { TestingService } from '../src/testing/service.mjs';
import { DEFAULT_PROJECT_ID, assertProjectOperation } from '../src/projects.mjs';
import { browserPartition, BROWSER_PARTITION } from '../src/testing/browser-policy.mjs';

const docData = {
  name: '工程需求',
  source: '/original.md',
  kind: 'md',
  content: '点击增加后显示计数1。',
  warnings: [],
};
const analysis = { content: '### F-001 计数\nAC-001-01 显示计数1。', createdAt: '2026-10-21' };
function setup(t, extra = {}) {
  const store = new WorkspaceStore(':memory:');
  const settings = { public: () => ({}), vault: {} };
  const testing = new TestingService({
    store,
    settings,
    browserFactory: (url, options) => ({
      projectId: options.projectId,
      visible: true,
      closed: false,
      alive() {
        return !this.closed;
      },
      close() {
        this.closed = true;
      },
      browse() {},
      info: () => ({ open: true, url }),
      ...options,
    }),
  });
  const workspace = new WorkspaceService({
    store,
    settings,
    feishu: { status: () => ({}) },
    testing,
    parseFile: async () => docData,
    ...extra,
  });
  t.after(() => {
    testing.close();
    store.close();
  });
  const a = DEFAULT_PROJECT_ID,
    b = store.projects.create({ name: '另一个工程' }).id;
  const add = (id) => {
    const doc = store.addDocument({ ...docData, projectId: id });
    store.saveAnalysis(doc.id, analysis);
    const chat = testing.createSession({ documentId: doc.id });
    const task = testing.createTask({ documentId: doc.id });
    return { doc, chat, task };
  };
  return { store, testing, workspace, a, b, add };
}

test('populated v5 migrates into default project without losing sources, conversations, runs, secrets or previews', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-upgrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'data.sqlite');
  const store = new WorkspaceStore(file);
  const settings = { vault: {} },
    testing = new TestingService({ store, settings });
  const doc = store.addDocument({
    ...docData,
    preview: { format: 'html', content: '<p>计数</p>' },
  });
  store.saveAnalysis(doc.id, analysis);
  const chat = testing.createSession({ documentId: doc.id }),
    task = testing.createTask({ documentId: doc.id });
  testing.db.saveRun({
    id: 'old-run',
    taskId: task.id,
    createdAt: '2026',
    status: 'passed',
    cases: [],
  });
  store.writeSettings({ apiKey: 'encrypted-retained' });
  for (const table of ['test_sources', 'test_sessions', 'test_tasks']) {
    store.db.exec(
      `DROP INDEX ${table}_project; UPDATE ${table} SET data=json_remove(data,'$.projectId')`,
    );
  }
  store.db.exec(
    'DROP INDEX documents_project; DROP INDEX documents_summary; DROP INDEX test_sessions_summary; DROP INDEX test_runs_summary; DROP INDEX test_runs_status; CREATE INDEX test_runs_task ON test_runs(task_id, created_at); ALTER TABLE documents DROP COLUMN project_id; DROP TABLE projects; DROP TABLE project_files; DROP TABLE project_cleanup; DROP TABLE command_runs; DROP TABLE command_settings; PRAGMA user_version=5;',
  );
  testing.close();
  store.close();
  const upgraded = new WorkspaceStore(file),
    service = new TestingService({ store: upgraded, settings });
  assert.equal(upgraded.getDocument(doc.id).projectId, DEFAULT_PROJECT_ID);
  assert.equal(upgraded.getDocument(doc.id).preview.content, '<p>计数</p>');
  assert.equal(service.getSession(chat.id).projectId, DEFAULT_PROJECT_ID);
  assert.equal(service.getTask(task.id).runs[0].id, 'old-run');
  assert.equal(upgraded.readSettings().apiKey, 'encrypted-retained');
  service.close();
  upgraded.close();
  const reopened = new WorkspaceStore(file);
  assert.equal(reopened.projects.list().length, 1);
  reopened.close();
});

test('lists, jobs and direct resource actions stay inside the selected project', (t) => {
  const { a, b, add, store, workspace, testing } = setup(t);
  const one = add(a),
    two = add(b);
  workspace.jobs.set(one.doc.id, { status: 'complete' });
  workspace.jobs.set(two.doc.id, { status: 'running' });
  testing.jobs.set(`chat:${two.chat.id}`, { status: 'running' });
  assert.deepEqual(
    workspace.snapshot(a).documents.map((x) => x.id),
    [one.doc.id],
  );
  assert.deepEqual(
    workspace.snapshot(a).testTasks.map((x) => x.id),
    [one.task.id],
  );
  assert.deepEqual(workspace.snapshot(a).testJobs, {});
  assert.equal(workspace.snapshot(a).jobs[two.doc.id], undefined);
  for (const [action, args] of [
    ['document', [two.doc.id]],
    ['chat-get', [two.chat.id]],
    ['testing-run', [two.task.id]],
    ['chat-create', [{ documentId: two.doc.id }]],
    ['chat-keep', [one.chat.id, 'message', two.task.id]],
    ['testing-cancel', [`chat:${two.chat.id}`]],
  ])
    assert.throws(() => assertProjectOperation(store, action, a, args), /不属于/);
  assertProjectOperation(store, 'document', a, [one.doc.id]);
});

test('an import retains its captured project while another project becomes active', async (t) => {
  let release;
  const parsed = new Promise((resolve) => {
    release = resolve;
  });
  const { a, b, workspace, store } = setup(t, { parseFile: () => parsed });
  const importOperation = workspace.runProject(a, () => workspace.importFiles(['/fixture.md'], a));
  assert.equal(workspace.snapshot(b).documents.length, 0);
  await assert.rejects(workspace.projectFiles.remove(a, '默认工程'), /等待/);
  release(docData);
  const result = await importOperation;
  assert.equal(store.getDocument(result.imported[0]).projectId, a);
});

test('selected document cleanup removes only its derived work, and deleting a project removes its entire data graph', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-clean-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cleared = [],
    { a, b, add, workspace, store, testing } = setup(t, {
      projectBrowser: { clearBrowserData: async (...args) => cleared.push(args) },
    });
  const one = add(a),
    second = add(a),
    other = add(b);
  const original = path.join(root, 'original.md'),
    generated = path.join(root, 'export.md'),
    retained = path.join(root, 'other.md');
  await writeFile(original, '原始文件');
  await writeFile(generated, '本工程报告');
  await writeFile(retained, '其他工程报告');
  store.db.prepare('UPDATE documents SET source=? WHERE id=?').run(original, one.doc.id);
  store.writeSettings({ apiKey: 'encrypted-global' });
  store.db
    .prepare('INSERT INTO browser_bookmarks VALUES (?,?,?,?,?)')
    .run('bookmark', 'key', '全局书签', 'https://example.org', '');
  await workspace.projectFiles.record(a, generated);
  await workspace.projectFiles.record(b, retained);
  for (const task of [one.task, second.task, other.task])
    testing.db.saveRun({
      id: `run-${task.id}`,
      taskId: task.id,
      createdAt: '2026',
      status: 'passed',
      cases: [],
    });
  const pageA = testing.openBrowser('standalone', { projectId: a }),
    pageB = testing.openBrowser('standalone', { projectId: b });
  await workspace.projectFiles.clean(a, { documentIds: [one.doc.id] });
  assert.throws(() => testing.getTask(one.task.id));
  assert.equal(testing.getTask(second.task.id).id, second.task.id);
  assert.equal(await readFile(original, 'utf8'), '原始文件');
  assert.equal(testing.browsers.has(pageA), false);
  assert.equal(testing.browsers.has(pageB), true);
  await assert.rejects(workspace.projectFiles.remove(a, '错误名称'), /完整工程名称/);
  await workspace.projectFiles.remove(a, '默认工程');
  assert.throws(() => store.projects.get(a), /不存在/);
  assert.equal(store.listDocuments(b).length, 1);
  assert.equal(testing.getTask(other.task.id).runs.length, 1);
  assert.equal(await readFile(retained, 'utf8'), '其他工程报告');
  await assert.rejects(access(generated));
  assert.equal(await readFile(original, 'utf8'), '原始文件');
  assert.equal(store.readSettings().apiKey, 'encrypted-global');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM browser_bookmarks').get().n, 1);
  assert.deepEqual(cleared.at(-1), [a, true]);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM project_cleanup').get().n, 1);
  assert.equal(testing.browsers.has(pageB), true);
});

test('externally edited exports block deletion until explicitly detached; missing files are safe to clean', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-exports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { a, workspace, store } = setup(t);
  const file = path.join(root, 'report.md');
  await writeFile(file, 'generated');
  await workspace.projectFiles.record(a, file);
  await writeFile(file, '用户修改');
  await assert.rejects(workspace.projectFiles.remove(a, '默认工程'), /外修改/);
  assert.ok(store.projects.get(a));
  const { exports } = await workspace.projectFiles.list(a);
  assert.equal(exports[0].status, 'changed');
  await workspace.projectFiles.clean(a, { exportIds: [exports[0].id], detach: true });
  await workspace.projectFiles.remove(a, '默认工程');
  assert.equal(await readFile(file, 'utf8'), '用户修改');
});

test('cleanup locks are scoped, fail safely on cache errors, and support an empty workspace', async (t) => {
  let release;
  const block = new Promise((resolve) => {
    release = resolve;
  });
  const { a, b, workspace, store } = setup(t, {
    projectBrowser: { clearBrowserData: async () => block },
  });
  const cleanup = workspace.projectFiles.clearCache(a);
  await assert.rejects(
    workspace.runProject(a, () => {}),
    /正在清理/,
  );
  await workspace.runProject(b, async () => assert.ok(store.projects.get(b)));
  release();
  await cleanup;
  workspace.projectFiles.clearBrowserData = async () => {
    throw new Error('缓存占用');
  };
  await assert.rejects(workspace.projectFiles.remove(a, '默认工程'), /占用/);
  assert.ok(store.projects.get(a));
  workspace.projectFiles.clearBrowserData = async () => {};
  await workspace.projectFiles.remove(a, '默认工程');
  await workspace.projectFiles.remove(b, '另一个工程');
  const snapshot = workspace.snapshot();
  assert.equal(snapshot.activeProjectId, null);
  assert.deepEqual(snapshot.documents, []);
  assert.deepEqual(snapshot.testTasks, []);
  assert.equal(store.projects.create({ name: '新的开始' }).name, '新的开始');
});

test('browser partitions retain legacy login in default project and separate other project sessions', () => {
  assert.equal(browserPartition(DEFAULT_PROJECT_ID), BROWSER_PARTITION);
  assert.notEqual(browserPartition('project-a'), browserPartition('project-b'));
  assert.equal(browserPartition('../outside').includes('..'), false);
});
