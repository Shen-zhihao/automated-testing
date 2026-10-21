import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_PROJECT_ID } from '../projects.mjs';

export function extractFeatures(markdown) {
  const features = new Map();
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^#{1,6}\s+(?:\*\*)?(F-\d+)\s+(.+)/i);
    const row = line.match(/^\|\s*(?:\*\*)?(F-\d+)(?:\*\*)?\s*\|\s*([^|]+)/i);
    const match = heading || row;
    if (match && !features.has(match[1]))
      features.set(match[1], { id: match[1], title: match[2].replace(/\*\*/g, '').trim() });
  }
  return [...features.values()];
}

export class TestingStore {
  constructor(store) {
    this.store = store;
  }
  get(table, id, label) {
    const row = this.store.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new Error(`${label}不存在。`);
    return JSON.parse(row.data);
  }
  source(id) {
    return this.get('test_sources', id, '需求快照');
  }
  session(id) {
    return this.get('test_sessions', id, '对话');
  }
  task(id) {
    return this.get('test_tasks', id, '测试任务');
  }
  run(id) {
    return this.get('test_runs', id, '执行记录');
  }
  sessionSummaries(projectId = DEFAULT_PROJECT_ID) {
    return this.store.db
      .prepare(
        `SELECT id, updated_at AS updatedAt, json_extract(data, '$.projectId') AS projectId,
      json_extract(data, '$.title') AS title, json_extract(data, '$.sourceId') AS sourceId,
      json_extract(data, '$.featureId') AS featureId, json_extract(data, '$.taskId') AS taskId
      FROM test_sessions WHERE json_extract(data, '$.projectId') = ? ORDER BY updated_at DESC, id`,
      )
      .all(projectId);
  }
  taskSummaries(projectId = DEFAULT_PROJECT_ID) {
    return this.store.db
      .prepare(
        `SELECT t.id, t.updated_at AS updatedAt, json_extract(t.data, '$.projectId') AS projectId,
      json_extract(t.data, '$.name') AS name, json_extract(t.data, '$.scope') AS scope,
      json_extract(t.data, '$.sourceId') AS sourceId, json_extract(s.data, '$.name') AS documentName,
      json_extract(t.data, '$.url') AS url, json_array_length(t.data, '$.notes') AS noteCount,
      json_type(t.data, '$.report') = 'object' AS hasReport,
      COALESCE(json_extract(t.data, '$.report.revision') != json_extract(t.data, '$.revision'), 0) AS reportStale,
      COALESCE(json_array_length(t.data, '$.report.cases'), 0) AS caseCount,
      (SELECT json_extract(r.data, '$.status') FROM test_runs r WHERE r.task_id=t.id ORDER BY r.created_at DESC, r.id LIMIT 1) AS lastRunStatus
      FROM test_tasks t JOIN test_sources s ON s.id = json_extract(t.data, '$.sourceId')
      WHERE json_extract(t.data, '$.projectId') = ?
      ORDER BY t.updated_at DESC, t.id`,
      )
      .all(projectId)
      .map((row) => ({
        ...row,
        hasReport: Boolean(row.hasReport),
        reportStale: Boolean(row.reportStale),
      }));
  }
  sourceReference(id) {
    const row = this.store.db
      .prepare(
        `SELECT s.id, json_extract(s.data, '$.projectId') AS projectId,
      json_extract(s.data, '$.documentId') AS documentId, json_extract(s.data, '$.name') AS name,
      json_extract(s.data, '$.analysisCreatedAt') AS analysisCreatedAt,
      json_extract(s.data, '$.features') AS features,
      COALESCE(d.content = json_extract(s.data, '$.content') AND json_extract(d.analysis, '$.content') = json_extract(s.data, '$.analysis'), 0) AS unchanged
      FROM test_sources s LEFT JOIN documents d ON d.id = json_extract(s.data, '$.documentId') WHERE s.id = ?`,
      )
      .get(id);
    if (!row) throw new Error('需求快照不存在。');
    const { unchanged, ...reference } = row;
    return { ...reference, features: JSON.parse(row.features), changed: !unchanged };
  }
  recentRunSummaries(taskId) {
    return this.store.db
      .prepare(
        `SELECT json_extract(data, '$.status') AS status,
      json_extract(data, '$.message') AS message, created_at AS createdAt
      FROM test_runs WHERE task_id = ? ORDER BY created_at DESC, id LIMIT 3`,
      )
      .all(taskId);
  }
  runs(taskId) {
    return this.store.db
      .prepare('SELECT data FROM test_runs WHERE task_id = ? ORDER BY created_at DESC, id')
      .all(taskId)
      .map((row) => JSON.parse(row.data));
  }
  saveSession(value) {
    this.store.db
      .prepare('INSERT OR REPLACE INTO test_sessions VALUES (?, ?, ?)')
      .run(value.id, value.updatedAt, JSON.stringify(value));
    return value;
  }
  saveTask(value) {
    this.store.db
      .prepare('INSERT OR REPLACE INTO test_tasks VALUES (?, ?, ?)')
      .run(value.id, value.updatedAt, JSON.stringify(value));
    return value;
  }
  saveRun(value) {
    this.store.db
      .prepare('INSERT OR REPLACE INTO test_runs VALUES (?, ?, ?, ?)')
      .run(value.id, value.taskId, value.createdAt, JSON.stringify(value));
    return value;
  }
  snapshot(document) {
    if (!document.analysis?.content) throw new Error('请先在文档分析中生成实施与验收文档。');
    const id = createHash('sha256')
      .update(JSON.stringify([document.id, document.content, document.analysis.content]))
      .digest('hex');
    const value = {
      id,
      documentId: document.id,
      projectId: document.projectId,
      name: document.name,
      source: document.source,
      kind: document.kind,
      content: document.content,
      analysis: document.analysis.content,
      analysisCreatedAt: document.analysis.createdAt || document.updatedAt,
      features: extractFeatures(document.analysis.content),
      createdAt: new Date().toISOString(),
    };
    this.store.db
      .prepare('INSERT OR IGNORE INTO test_sources VALUES (?, ?)')
      .run(id, JSON.stringify(value));
    return this.source(id);
  }
  recoverInterrupted() {
    for (const row of this.store.db
      .prepare("SELECT data FROM test_runs WHERE json_extract(data, '$.status') = 'running'")
      .all()) {
      const run = JSON.parse(row.data);
      if (run.status === 'running')
        this.saveRun({
          ...run,
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
          message: '应用退出，执行已中断；未完成项目不计为通过。',
        });
    }
  }
}
export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
