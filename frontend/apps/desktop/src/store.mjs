import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROJECT_ID, migrateProjects, ProjectStore } from './projects.mjs';

export class WorkspaceStore {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ':memory:' && process.platform !== 'win32') chmodSync(file, 0o600);
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA secure_delete = ON;',
    );
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 8) {
      this.db.close();
      throw new Error('本地数据由更新版本创建，请升级应用后打开。');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL,
        kind TEXT NOT NULL, content TEXT NOT NULL, warnings TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, analysis TEXT
      );
    `);
    if (version < 2) {
      this.db.exec(
        'BEGIN; ALTER TABLE documents ADD COLUMN preview TEXT; PRAGMA user_version = 2; COMMIT;',
      );
    }
    if (version < 3) {
      this.db.exec(`BEGIN;
        CREATE TABLE test_sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE test_sessions (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE test_tasks (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE test_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX test_runs_task ON test_runs(task_id, created_at);
        PRAGMA user_version = 3;
        COMMIT;`);
    }
    if (version < 4) {
      this.db.exec(
        `BEGIN; CREATE TABLE browser_accounts (origin TEXT PRIMARY KEY, data TEXT NOT NULL); PRAGMA user_version = 4; COMMIT;`,
      );
    }
    if (version < 5) {
      this.db.exec(`BEGIN;
        CREATE TABLE browser_bookmarks (id TEXT PRIMARY KEY, import_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT NOT NULL, folder TEXT NOT NULL);
        CREATE TABLE browser_passwords (id TEXT PRIMARY KEY, import_key TEXT NOT NULL UNIQUE, origin TEXT NOT NULL, username_label TEXT NOT NULL, encrypted TEXT NOT NULL);
        PRAGMA user_version = 5; COMMIT;`);
    }
    if (version < 6) migrateProjects(this.db);
    if (version < 7)
      this.db.exec(`BEGIN;
      CREATE TABLE command_settings (project_id TEXT PRIMARY KEY, mode TEXT NOT NULL);
      CREATE TABLE command_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX command_runs_project ON command_runs(project_id, created_at);
      PRAGMA user_version = 7; COMMIT;`);
    if (version < 8)
      this.db.exec(`BEGIN;
      CREATE INDEX documents_summary ON documents (
        project_id, created_at DESC, id, name, source, kind, length(content), updated_at, analysis IS NOT NULL
      );
      CREATE INDEX test_sessions_summary ON test_sessions (
        json_extract(data, '$.projectId'), updated_at DESC, id,
        json_extract(data, '$.title'), json_extract(data, '$.sourceId'),
        json_extract(data, '$.featureId'), json_extract(data, '$.taskId')
      );
      DROP INDEX test_runs_task;
      CREATE INDEX test_runs_summary ON test_runs (
        task_id, created_at DESC, id, json_extract(data, '$.status'), json_extract(data, '$.message')
      );
      CREATE INDEX test_runs_status ON test_runs (json_extract(data, '$.status'));
      DROP INDEX command_runs_project;
      CREATE INDEX command_runs_project ON command_runs (project_id, created_at DESC, id DESC);
      CREATE INDEX command_runs_status ON command_runs (json_extract(data, '$.status'), created_at, id);
      PRAGMA user_version = 8; COMMIT;`);
    this.projects = new ProjectStore(this);
  }

  readSettings() {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('workspace');
    return row ? JSON.parse(row.value) : null;
  }

  writeSettings(value) {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('workspace', JSON.stringify(value));
  }

  listDocuments(projectId = DEFAULT_PROJECT_ID) {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, name, source, kind, length(content) AS characters,
      created_at AS createdAt, updated_at AS updatedAt, analysis IS NOT NULL AS analyzed
      FROM documents WHERE project_id = ? ORDER BY created_at DESC, id`,
      )
      .all(projectId)
      .map((row) => ({ ...row, analyzed: Boolean(row.analyzed) }));
  }

  getDocument(id) {
    if (typeof id !== 'string') throw new Error('文档标识无效。');
    const row = this.db
      .prepare(
        `SELECT id, project_id AS projectId, name, source, kind, content, warnings,
      created_at AS createdAt, updated_at AS updatedAt, analysis, preview FROM documents WHERE id = ?`,
      )
      .get(id);
    if (!row) throw new Error('文档不存在，可能已被移除。');
    return {
      ...row,
      warnings: JSON.parse(row.warnings),
      analysis: row.analysis ? JSON.parse(row.analysis) : null,
      preview: row.preview ? JSON.parse(row.preview) : null,
    };
  }

  addDocument({
    name,
    source,
    kind,
    content,
    warnings = [],
    preview = null,
    projectId = DEFAULT_PROJECT_ID,
  }) {
    this.projects.get(projectId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO documents (id, name, source, kind, content, warnings, created_at, updated_at, preview, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        source,
        kind,
        content,
        JSON.stringify(warnings),
        now,
        now,
        JSON.stringify(preview),
        projectId,
      );
    return this.getDocument(id);
  }

  updateDocumentSource(id, { content, warnings = [], preview = null }) {
    const previous = this.getDocument(id);
    this.db
      .prepare(
        `UPDATE documents SET content = ?, warnings = ?, preview = ?,
      analysis = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        content,
        JSON.stringify(warnings),
        JSON.stringify(preview),
        previous.content === content && previous.analysis
          ? JSON.stringify(previous.analysis)
          : null,
        new Date().toISOString(),
        id,
      );
    return this.getDocument(id);
  }

  saveAnalysis(id, analysis) {
    this.getDocument(id);
    this.db
      .prepare('UPDATE documents SET analysis = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(analysis), new Date().toISOString(), id);
  }

  deleteDocument(id) {
    this.getDocument(id);
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }

  close() {
    this.db.close();
  }
}
