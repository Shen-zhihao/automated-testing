import { performance } from 'node:perf_hooks';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from '../src/store.mjs';
import { TestingStore } from '../src/testing/store.mjs';
import { TerminalService } from '../src/terminal/service.mjs';
import { WorkspaceService } from '../src/workspace.mjs';

// Only synthetic, in-memory data is used. This never opens an application database.
if (!global.gc) throw new Error('请使用 node --expose-gc scripts/benchmark-resources.mjs。');
const root = fileURLToPath(new URL('../', import.meta.url));
const store = new WorkspaceStore(':memory:');
const testing = new TestingStore(store);
const projectId = store.projects.list()[0].id;
const timestamp = '2026-10-21T00:00:00.000Z';
const dataset = { documents: 250, documentCharacters: 40000, sessions: 120, commands: 100 };
const documentText = '需求正文 ABC '.repeat(4000).slice(0, dataset.documentCharacters);
dataset.documentCharacters = documentText.length;
store.db.exec('BEGIN');
try {
  const insert = store.db.prepare(
    'INSERT INTO documents (id, project_id, name, source, kind, content, warnings, created_at, updated_at, preview) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < dataset.documents; i++)
    insert.run(
      `document-${i}`,
      projectId,
      `需求 ${i}`,
      '/synthetic/requirements.txt',
      'txt',
      documentText,
      '[]',
      timestamp,
      timestamp,
      null,
    );
  for (let i = 0; i < dataset.sessions; i++)
    testing.saveSession({
      id: `session-${i}`,
      projectId,
      title: `讨论 ${i}`,
      sourceId: 'synthetic-source',
      featureId: '',
      taskId: null,
      updatedAt: timestamp,
      messages: [{ role: 'assistant', content: '回复'.repeat(16000) }],
    });
  const insertCommand = store.db.prepare('INSERT INTO command_runs VALUES (?, ?, ?, ?)');
  for (let i = 0; i < dataset.commands; i++) {
    const run = {
      id: `command-${i}`,
      projectId,
      command: 'node --version',
      reason: '合成性能数据',
      status: 'complete',
      output: '日志 A '.repeat(30000).slice(0, 128 * 1024),
      fingerprint: 'synthetic-fingerprint',
      createdAt: timestamp,
      exitCode: 0,
    };
    insertCommand.run(run.id, projectId, timestamp, JSON.stringify(run));
  }
  store.db.exec('COMMIT');
} catch (error) {
  store.db.exec('ROLLBACK');
  throw error;
}
const workspace = { store, notify() {} };
const terminal = new TerminalService(workspace, { root: os.tmpdir() });
const overview = new WorkspaceService({
  store,
  settings: { public: () => ({}) },
  feishu: { status: () => ({}) },
  testing: {
    snapshot: (id) => ({ testSessions: testing.sessionSummaries(id), testTasks: [], testJobs: {} }),
  },
});
function measure(operation) {
  for (let i = 0; i < 3; i++) operation();
  const times = [],
    allocations = [];
  for (let i = 0; i < 15; i++) {
    global.gc();
    const startHeap = process.memoryUsage().heapUsed;
    const started = performance.now();
    const value = operation();
    times.push(performance.now() - started);
    allocations.push(process.memoryUsage().heapUsed - startHeap);
    if (value?.length === -1) throw new Error('Unreachable');
  }
  times.sort((a, b) => a - b);
  allocations.sort((a, b) => a - b);
  return {
    medianMs: Number(times[7].toFixed(3)),
    p95Ms: Number(times[14].toFixed(3)),
    medianHeapAllocationBytes: allocations[7],
  };
}
function importDiagnostic(specifier) {
  const source = `global.gc(); const before=process.memoryUsage(); const start=performance.now(); await import(${JSON.stringify(specifier)}); global.gc(); const after=process.memoryUsage(); console.log(JSON.stringify({elapsedMs:performance.now()-start,heapBytes:after.heapUsed-before.heapUsed,rssBytes:after.rss-before.rss}));`;
  const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', source], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim());
}
async function size(file) {
  return (await stat(file)).size;
}
async function bundleSize() {
  const dir = path.resolve(root, '../agent-web/dist');
  const html = await readFile(path.join(dir, 'index.html'), 'utf8');
  const entry = html.match(/src="\.\/([^"]+\.js)"/)?.[1];
  const assets = await readdir(path.join(dir, 'assets'));
  return {
    entryJsBytes: entry ? await size(path.join(dir, entry)) : null,
    totalJsBytes: (
      await Promise.all(
        assets
          .filter((name) => name.endsWith('.js'))
          .map((name) => size(path.join(dir, 'assets', name))),
      )
    ).reduce((sum, bytes) => sum + bytes, 0),
  };
}
try {
  const result = {
    scope:
      'Synthetic SQLite/API and isolated Node imports; not complete Electron RSS or installed launch time',
    sourceLabel: process.argv[3] || 'working-tree',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    dataset,
    operations: {
      documents: measure(() => store.listDocuments(projectId)),
      sessions: measure(() => testing.sessionSummaries(projectId)),
      commands: measure(() => terminal.list(projectId)),
      recoverCommands: measure(() => new TerminalService(workspace, { root: os.tmpdir() })),
      globalSnapshot: measure(() => overview.snapshot(null)),
    },
    snapshotBytes: {
      defaultProject: Buffer.byteLength(JSON.stringify(overview.snapshot())),
      global: Buffer.byteLength(JSON.stringify(overview.snapshot(null))),
    },
    imports: {
      vite: importDiagnostic('vite'),
      testing: importDiagnostic('./src/testing/service.mjs'),
    },
    ui: await bundleSize(),
    runtimeIcon: {
      masterBytes: await size(path.join(root, 'assets/brand/icon.png')),
      packagedBytes: await size(
        path.join(
          root,
          JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).build.files.find(
            (file) => /^assets\/brand\/.*\.png$/.test(file),
          ),
        ),
      ),
    },
  };
  const output = process.argv[2];
  if (output) {
    const file = path.resolve(output);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  store.close();
}
