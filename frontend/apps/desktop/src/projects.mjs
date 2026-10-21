import { randomUUID } from 'node:crypto';

export const DEFAULT_PROJECT_ID = 'local-default';

export function migrateProjects(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
    const date = new Date().toISOString();
    db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run(
      DEFAULT_PROJECT_ID,
      '默认工程',
      '已有需求、讨论和测试资料保留在此工程中。',
      date,
      date,
    );
    db.exec(`ALTER TABLE documents ADD COLUMN project_id TEXT NOT NULL DEFAULT 'local-default';
      CREATE INDEX documents_project ON documents(project_id, created_at);`);
    for (const table of ['test_sources', 'test_sessions', 'test_tasks']) {
      db.prepare(`UPDATE ${table} SET data = json_set(data, '$.projectId', ?)`).run(
        DEFAULT_PROJECT_ID,
      );
      db.exec(`CREATE INDEX ${table}_project ON ${table}(json_extract(data, '$.projectId'));`);
    }
    db.exec(
      `CREATE TABLE project_files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX project_files_project ON project_files(project_id); CREATE TABLE project_cleanup (project_id TEXT PRIMARY KEY); PRAGMA user_version = 6; COMMIT;`,
    );
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function fields(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  if (!name || name.length > 80) throw new Error('工程名称请填写 1–80 个字符。');
  if (description.length > 1000) throw new Error('工程说明最多 1000 个字符。');
  return { name, description };
}

export class ProjectStore {
  constructor(store) {
    this.store = store;
  }
  get(id) {
    if (typeof id !== 'string' || !id) throw new Error('请先选择工程。');
    const project = this.store.db
      .prepare(
        'SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?',
      )
      .get(id);
    if (!project) throw new Error('工程不存在，请从工程列表重新选择。');
    return project;
  }
  list() {
    return this.store.db
      .prepare(
        `SELECT p.id, p.name, p.description, p.created_at AS createdAt, p.updated_at AS updatedAt,
      (SELECT count(*) FROM documents WHERE project_id=p.id) AS documentCount,
      (SELECT coalesce(sum(analysis IS NOT NULL), 0) FROM documents WHERE project_id=p.id) AS analyzedCount,
      (SELECT count(*) FROM test_sessions WHERE json_extract(data, '$.projectId')=p.id) AS chatCount,
      (SELECT count(*) FROM test_tasks WHERE json_extract(data, '$.projectId')=p.id) AS taskCount
      FROM projects p ORDER BY p.updated_at DESC, p.id`,
      )
      .all();
  }
  create(input) {
    const { name, description } = fields(input),
      id = randomUUID(),
      date = new Date().toISOString();
    this.store.db
      .prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)')
      .run(id, name, description, date, date);
    return this.get(id);
  }
  update(id, input) {
    this.get(id);
    const { name, description } = fields(input);
    this.store.db
      .prepare('UPDATE projects SET name=?, description=?, updated_at=? WHERE id=?')
      .run(name, description, new Date().toISOString(), id);
    return this.get(id);
  }
  assertResource(projectId, kind, id) {
    this.get(projectId);
    const tables = { chat: 'test_sessions', task: 'test_tasks', source: 'test_sources' };
    if (kind !== 'document' && !Object.hasOwn(tables, kind)) throw new Error('资料类型无效。');
    const row =
      kind === 'document'
        ? this.store.db.prepare('SELECT project_id AS projectId FROM documents WHERE id=?').get(id)
        : this.store.db
            .prepare(
              `SELECT json_extract(data, '$.projectId') AS projectId FROM ${tables[kind]} WHERE id=?`,
            )
            .get(id);
    if (!row || row.projectId !== projectId)
      throw new Error('这份资料不属于当前工程，请在所属工程中打开。');
  }
}

const documentActions = new Set([
  'document',
  'analysis-draft',
  'revise-analysis',
  'testing-features',
  'refresh-document',
  'delete-document',
  'analyze',
  'export-analysis',
  'cancel',
]);
const chatActions = new Set(['chat-get', 'chat-send', 'chat-keep', 'chat-rename', 'chat-delete']);
const taskActions = new Set([
  'testing-get',
  'testing-update',
  'testing-document',
  'testing-plan',
  'testing-run',
  'testing-export',
]);
export const projectActions = new Set([
  ...documentActions,
  ...chatActions,
  ...taskActions,
  'chat-create',
  'testing-create',
  'testing-cancel',
  'import-files',
  'import-feishu',
]);

export function assertProjectOperation(store, action, projectId, args) {
  const projects = store.projects;
  projects.get(projectId);
  if (documentActions.has(action)) projects.assertResource(projectId, 'document', args[0]);
  if (chatActions.has(action)) projects.assertResource(projectId, 'chat', args[0]);
  if (action === 'chat-send' && args[2] !== undefined) {
    if (!Array.isArray(args[2]) || args[2].length > 5) throw new Error('每轮最多引用 5 份文档。');
    for (const id of args[2]) projects.assertResource(projectId, 'document', id);
  }
  if (taskActions.has(action)) projects.assertResource(projectId, 'task', args[0]);
  if (action === 'chat-keep' && args[2]) projects.assertResource(projectId, 'task', args[2]);
  if (action === 'chat-create' || action === 'testing-create') {
    const input = args[0];
    for (const [field, kind] of [
      ['documentId', 'document'],
      ['sessionId', 'chat'],
      ['taskId', 'task'],
    ])
      if (input?.[field]) projects.assertResource(projectId, kind, input[field]);
  }
  if (action === 'testing-cancel') {
    const match = typeof args[0] === 'string' && args[0].match(/^(chat|task):(.+)$/);
    if (!match) throw new Error('任务标识无效。');
    projects.assertResource(projectId, match[1], match[2]);
  }
}
