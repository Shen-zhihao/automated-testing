import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class WorkspaceStore {
  constructor(file) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ':memory:' && process.platform !== 'win32') chmodSync(file, 0o600);
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;',
    );
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('本地数据由更新版本创建，请升级应用后打开。');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL,
        kind TEXT NOT NULL, content TEXT NOT NULL, warnings TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, analysis TEXT
      );
      PRAGMA user_version = 1;
    `);
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

  listDocuments() {
    return this.db
      .prepare(
        `SELECT id, name, source, kind, length(content) AS characters,
      created_at AS createdAt, updated_at AS updatedAt, analysis IS NOT NULL AS analyzed
      FROM documents ORDER BY created_at DESC, id`,
      )
      .all()
      .map((row) => ({ ...row, analyzed: Boolean(row.analyzed) }));
  }

  getDocument(id) {
    if (typeof id !== 'string') throw new Error('文档标识无效。');
    const row = this.db
      .prepare(
        `SELECT id, name, source, kind, content, warnings,
      created_at AS createdAt, updated_at AS updatedAt, analysis FROM documents WHERE id = ?`,
      )
      .get(id);
    if (!row) throw new Error('文档不存在，可能已被移除。');
    return {
      ...row,
      warnings: JSON.parse(row.warnings),
      analysis: row.analysis ? JSON.parse(row.analysis) : null,
    };
  }

  addDocument({ name, source, kind, content, warnings = [] }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO documents (id, name, source, kind, content, warnings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, source, kind, content, JSON.stringify(warnings), now, now);
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
