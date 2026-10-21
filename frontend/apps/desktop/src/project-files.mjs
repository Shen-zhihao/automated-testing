import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export class ProjectFiles {
  constructor(workspace, { clearBrowserData = async () => {}, cacheSize = async () => 0 } = {}) {
    Object.assign(this, { workspace, clearBrowserData, cacheSize });
    this.store = workspace.store;
  }
  async record(projectId, file) {
    if (!file) return null;
    this.store.projects.get(projectId);
    const resolved = await realpath(file),
      hash = await hashFile(resolved);
    this.store.db
      .prepare(
        `INSERT INTO project_files VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET project_id=excluded.project_id, sha256=excluded.sha256, created_at=excluded.created_at`,
      )
      .run(
        randomUUID(),
        projectId,
        path.basename(resolved),
        resolved,
        hash,
        new Date().toISOString(),
      );
    this.workspace.notify();
    return file;
  }
  async inspect(file) {
    try {
      const info = await lstat(file.path);
      if (!info.isFile() || info.isSymbolicLink()) return { ...file, status: 'changed', bytes: 0 };
      return {
        ...file,
        status: (await hashFile(file.path)) === file.sha256 ? 'saved' : 'changed',
        bytes: info.size,
      };
    } catch (error) {
      if (error.code === 'ENOENT') return { ...file, status: 'missing', bytes: 0 };
      throw new Error(`无法读取导出文件：${file.path}`);
    }
  }
  async list(projectId) {
    this.store.projects.get(projectId);
    const rows = this.store.db
      .prepare(
        'SELECT id, name, path, sha256, created_at AS createdAt FROM project_files WHERE project_id=? ORDER BY created_at DESC',
      )
      .all(projectId);
    const exports = [];
    for (const row of rows) {
      const { sha256, ...file } = await this.inspect(row);
      exports.push(file);
    }
    return {
      exports,
      ...(this.workspace.terminal
        ? {
            commandDirectory: this.workspace.terminal.directory(projectId),
            commandBytes: await this.workspace.terminal.size(projectId),
          }
        : {}),
      cacheBytes: await this.cacheSize(projectId),
      documentBytes: this.store.db
        .prepare(
          'SELECT COALESCE(sum(length(CAST(content AS BLOB))+COALESCE(length(CAST(preview AS BLOB)),0)+COALESCE(length(CAST(analysis AS BLOB)),0)),0) AS bytes FROM documents WHERE project_id=?',
        )
        .get(projectId).bytes,
    };
  }
  async exclusive(projectId, operation) {
    this.workspace.assertProjectIdle(projectId);
    this.workspace.projectLocks.add(projectId);
    try {
      return await operation();
    } finally {
      this.workspace.projectLocks.delete(projectId);
      this.workspace.notify();
    }
  }
  async removeExports(projectId, ids, detach = false) {
    const rows = ids.map((id) => {
      const file = this.store.db
        .prepare('SELECT * FROM project_files WHERE id=? AND project_id=?')
        .get(id, projectId);
      if (!file) throw new Error('导出文件不属于当前工程。');
      return file;
    });
    const checked = [];
    for (const row of rows) checked.push(await this.inspect(row));
    if (!detach) {
      const changed = checked.find((file) => file.status === 'changed');
      if (changed)
        throw new Error(
          `文件已在应用外修改，请先选择“保留文件并解除关联”再清理工程：${changed.path}`,
        );
      for (const file of checked) if (file.status === 'saved') await unlink(file.path);
    }
    for (const row of rows)
      this.store.db
        .prepare('DELETE FROM project_files WHERE id=? AND project_id=?')
        .run(row.id, projectId);
  }
  purgeSources(projectId, documentIds) {
    const db = this.store.db;
    if (!documentIds) {
      db.prepare(
        "DELETE FROM test_runs WHERE task_id IN (SELECT id FROM test_tasks WHERE json_extract(data, '$.projectId')=?)",
      ).run(projectId);
      for (const table of ['test_tasks', 'test_sessions', 'test_sources'])
        db.prepare(`DELETE FROM ${table} WHERE json_extract(data, '$.projectId')=?`).run(projectId);
      return;
    }
    const sources = db
      .prepare(
        "SELECT id, json_extract(data, '$.documentId') AS documentId FROM test_sources WHERE json_extract(data, '$.projectId')=?",
      )
      .all(projectId)
      .filter((row) => !documentIds || documentIds.includes(row.documentId));
    for (const source of sources) {
      db.prepare(
        "DELETE FROM test_runs WHERE task_id IN (SELECT id FROM test_tasks WHERE json_extract(data, '$.sourceId')=?)",
      ).run(source.id);
      for (const table of ['test_tasks', 'test_sessions'])
        db.prepare(`DELETE FROM ${table} WHERE json_extract(data, '$.sourceId')=?`).run(source.id);
      db.prepare(
        `DELETE FROM test_sessions WHERE EXISTS (
          SELECT 1 FROM json_each(test_sessions.data, '$.messages') message,
          json_each(message.value, '$.sourceIds') reference WHERE reference.value = ?
        )`,
      ).run(source.id);
      db.prepare('DELETE FROM test_sources WHERE id=?').run(source.id);
    }
  }
  clearMemory(projectId, documentIds, keys) {
    const testing = this.workspace.testing;
    for (const id of documentIds) this.workspace.jobs.delete(id);
    for (const key of keys) {
      testing?.jobs.delete(key);
      if (key.startsWith('task:')) testing?.retiredBrowsers.delete(key.slice(5));
    }
    testing?.closeProjectBrowsers(projectId);
  }
  clean(projectId, input) {
    return this.exclusive(projectId, async () => {
      const { documentIds = [], exportIds = [], detach = false } = input || {};
      for (const ids of [documentIds, exportIds])
        if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string'))
          throw new Error('每次最多选择 200 份文件。');
      for (const id of documentIds) this.store.projects.assertResource(projectId, 'document', id);
      await this.removeExports(projectId, exportIds, detach === true);
      if (input?.cleanCommands === true) await this.workspace.terminal?.clearFiles(projectId);
      const snapshot = this.workspace.testing?.snapshot(projectId);
      this.store.db.exec('BEGIN');
      try {
        this.purgeSources(projectId, documentIds);
        for (const id of documentIds) this.store.deleteDocument(id);
        this.store.db.exec('COMMIT');
      } catch (error) {
        this.store.db.exec('ROLLBACK');
        throw error;
      }
      const remaining = this.workspace.testing?.snapshot(projectId);
      const removedKeys = [
        ...(snapshot?.testSessions || [])
          .filter((item) => !remaining?.testSessions.some((next) => next.id === item.id))
          .map((item) => `chat:${item.id}`),
        ...(snapshot?.testTasks || [])
          .filter((item) => !remaining?.testTasks.some((next) => next.id === item.id))
          .map((item) => `task:${item.id}`),
      ];
      this.clearMemory(projectId, documentIds, removedKeys);
    });
  }
  clearCache(projectId) {
    return this.exclusive(projectId, async () => {
      this.workspace.testing?.closeProjectBrowsers(projectId);
      await this.clearBrowserData(projectId, false);
    });
  }
  remove(projectId, confirmation) {
    return this.exclusive(projectId, async () => {
      const project = this.store.projects.get(projectId);
      if (confirmation !== project.name) throw new Error('请输入完整工程名称确认删除。');
      const files = this.store.db
        .prepare('SELECT id FROM project_files WHERE project_id=?')
        .all(projectId);
      await this.removeExports(
        projectId,
        files.map((file) => file.id),
      );
      const documents = this.store.listDocuments(projectId),
        snapshot = this.workspace.testing?.snapshot(projectId);
      this.workspace.testing?.closeProjectBrowsers(projectId);
      await this.clearBrowserData(projectId, true);
      await this.workspace.terminal?.clearFiles(projectId);
      this.store.db.exec('BEGIN');
      try {
        this.purgeSources(projectId);
        this.store.db.prepare('DELETE FROM documents WHERE project_id=?').run(projectId);
        this.store.db.prepare('DELETE FROM command_settings WHERE project_id=?').run(projectId);
        this.store.db.prepare('DELETE FROM command_runs WHERE project_id=?').run(projectId);
        this.store.db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
        this.store.db.prepare('INSERT OR IGNORE INTO project_cleanup VALUES (?)').run(projectId);
        this.store.db.exec('COMMIT');
      } catch (error) {
        this.store.db.exec('ROLLBACK');
        throw error;
      }
      this.clearMemory(
        projectId,
        documents.map((doc) => doc.id),
        [
          ...(snapshot?.testSessions || []).map((item) => `chat:${item.id}`),
          ...(snapshot?.testTasks || []).map((item) => `task:${item.id}`),
        ],
      );
      // Remove deleted content from free pages and the WAL without changing other projects.
      this.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    });
  }
}
