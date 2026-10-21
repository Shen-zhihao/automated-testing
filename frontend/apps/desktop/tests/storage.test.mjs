import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';
import { StorageService } from '../src/storage.mjs';
import { WorkspaceStore } from '../src/store.mjs';

async function setup(t, options) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'test-agent-migration-'));
  const service = new StorageService(path.join(root, 'profile'), options);
  const target = path.join(root, '中文 数据目录');
  await mkdir(target);
  t.after(async () => {
    service.store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { service, root, target };
}

test('migration includes WAL, previews, reports and encrypted settings; restart uses the new directory', async (t) => {
  const { service, target, root } = await setup(t);
  const store = service.store;
  const oldFile = store.file;
  store.db.exec('PRAGMA wal_autocheckpoint = 0');
  store.writeSettings({
    model: { model: 'fixture' },
    apiKey: 'encrypted-fixture',
    feishu: { appSecret: 'encrypted-app-fixture' },
  });
  const doc = store.addDocument({
    name: '需求',
    source: 'fixture',
    kind: 'html',
    content: '表格需求',
    preview: { format: 'html', content: '<table><tr><td>需求</td></tr></table>' },
  });
  store.saveAnalysis(doc.id, { content: '已有分析' });
  const original = store.getDocument(doc.id);
  await service.relocate(target);
  assert.equal(
    service.store,
    store,
    'existing service references must keep using the active database',
  );
  assert.deepEqual(store.getDocument(doc.id), original);
  assert.equal(store.readSettings().apiKey, 'encrypted-fixture');
  assert.equal(store.readSettings().feishu.appSecret, 'encrypted-app-fixture');
  store.addDocument({ name: '迁移后', source: 'fixture', kind: 'txt', content: '新数据' });
  const old = new WorkspaceStore(oldFile);
  assert.equal(old.listDocuments().length, 1);
  old.close();
  const reopened = new StorageService(path.join(root, 'profile'));
  assert.equal(reopened.info().directory, await realpath(target));
  assert.equal(reopened.store.listDocuments().length, 2);
  reopened.store.close();
  await service.relocate(target); // selecting the same folder is a no-op
  assert.equal(store.listDocuments().length, 2);
});

test('occupied target, failed backup and failed location write preserve the original data and pointer', async (t) => {
  const { service, target } = await setup(t);
  const original = service.info().databasePath;
  const targetFile = path.join(target, 'test-agent.sqlite');
  await writeFile(targetFile, 'existing-user-file');
  await assert.rejects(service.relocate(target), /同名/);
  assert.equal(await readFile(targetFile, 'utf8'), 'existing-user-file');
  await rm(targetFile);
  service.backupDatabase = async () => {
    throw new Error('disk-full');
  };
  await assert.rejects(service.relocate(target), /disk-full/);
  assert.deepEqual(await readdir(target), []);
  service.backupDatabase = backup;
  service.persistDirectory = () => {
    throw new Error('config-not-writable');
  };
  await assert.rejects(service.relocate(target), /config-not-writable/);
  assert.deepEqual(await readdir(target), []);
  assert.equal(service.info().databasePath, original);
  service.store.addDocument({
    name: 'still writable',
    source: 'fixture',
    kind: 'txt',
    content: 'retained',
  });
  assert.equal(service.store.listDocuments().length, 1);
  assert.equal(service.migrating, false);
});

test('migration refuses pending writes and blocks new operations until the switch finishes', async (t) => {
  let release, releaseBackup;
  const { service, target } = await setup(t, {
    backupDatabase: async (db, file) => {
      await new Promise((resolve) => {
        releaseBackup = resolve;
      });
      return backup(db, file);
    },
  });
  const pendingWrite = service.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(service.relocate(target), /等待/);
  release();
  await pendingWrite;
  const migration = service.relocate(target);
  await assert.rejects(
    service.run(() => service.store.writeSettings({})),
    /迁移/,
  );
  await assert.rejects(service.relocate(target), /迁移/);
  while (!releaseBackup) await new Promise((resolve) => setImmediate(resolve));
  releaseBackup();
  await migration;
  await service.run(() => service.store.writeSettings({ preserved: true }));
  assert.equal(service.store.readSettings().preserved, true);
});

test('missing custom storage never silently opens a new empty database', async (t) => {
  const { service, root } = await setup(t);
  await writeFile(
    service.configFile,
    JSON.stringify({ version: 1, directory: path.join(root, 'missing') }),
  );
  assert.throws(() => new StorageService(path.join(root, 'profile')), /不会创建空库/);
});

test('v1 data upgrades without losing content, and source refresh preserves reports only when text is unchanged', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'test-agent-schema-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, warnings TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, analysis TEXT);
    INSERT INTO documents VALUES ('existing','需求','/fixture','docx','原文字','[]','2026','2026','{"content":"原分析"}'); PRAGMA user_version=1;`);
  old.close();
  const store = new WorkspaceStore(file);
  t.after(() => store.close());
  assert.equal(store.getDocument('existing').preview, null);
  assert.equal(
    store.updateDocumentSource('existing', {
      content: '原文字',
      preview: { format: 'html', content: '<p>原文字</p>' },
    }).analysis.content,
    '原分析',
  );
  assert.equal(store.updateDocumentSource('existing', { content: '新文字' }).analysis, null);
});
