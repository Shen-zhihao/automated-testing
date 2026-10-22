import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import electron from 'electron';
import { WorkspaceStore } from '../src/store.mjs';

// 启动真实 Electron 与已构建 UI，但只打开临时空资料目录，不触及用户数据库或凭据。
const root = fileURLToPath(new URL('../', import.meta.url));
const samples = [];
for (let index = 0; index < 3; index++) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'xuzhou-startup-'));
  try {
    if (process.argv[4] === 'chat') {
      const store = new WorkspaceStore(path.join(profile, 'Test Agent/storage/test-agent.sqlite'));
      try {
        const projectId = store.projects.list()[0].id;
        const timestamp = '2026-10-22T00:00:00Z';
        const content =
          '## 验收场景\n\n| 条件 | 结果 |\n| --- | --- |\n| 连续失败 | 保留数据 |\n\n' +
          '- 失败恢复规则与验证依据。\n'.repeat(80);
        const messages = Array.from({ length: 400 }, (_, message) => ({
          id: `message-${message}`,
          role: message % 2 ? 'assistant' : 'user',
          content: message % 2 ? content : `核验场景 ${message}`,
          status: 'complete',
          sourceIds: [],
          createdAt: timestamp,
        }));
        const session = {
          id: 'benchmark-chat',
          projectId,
          title: '性能测试对话',
          sourceId: null,
          featureId: '',
          taskId: null,
          messages,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        store.db
          .prepare('INSERT INTO test_sessions VALUES (?, ?, ?)')
          .run(session.id, timestamp, JSON.stringify(session));
      } finally {
        store.close();
      }
    }
    samples.push(
      await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const started = performance.now();
        const child = spawn(
          electron,
          [
            path.join(root, 'scripts/startup-probe.mjs'),
            profile,
            process.argv[4] ?? 'startup',
            String(index),
          ],
          {
            cwd: root,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '',
          stderr = '';
        const timeout = setTimeout(() => child.kill('SIGKILL'), 25000);
        child.stdout.on('data', (data) => {
          stdout += data;
        });
        child.stderr.on('data', (data) => {
          stderr = (stderr + data).slice(-6000);
        });
        child.on('error', reject);
        child.on('close', (code) => {
          clearTimeout(timeout);
          const record = stdout.split('\n').find((line) => line.startsWith('STARTUP_PROBE:'));
          if (code !== 0 || !record) {
            reject(new Error(stderr || `Electron probe failed: ${code}`));
            return;
          }
          resolve({
            ...JSON.parse(record.slice('STARTUP_PROBE:'.length)),
            processElapsedMs: performance.now() - started,
          });
        });
      }),
    );
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
const median = (values) => values.toSorted((a, b) => a - b)[1];
const result = {
  scope:
    'Real Electron, hidden first window, built UI, temporary synthetic profiles; not installed launch or populated-user RSS',
  label: process.argv[3] ?? 'working-tree',
  scenario: process.argv[4] ?? 'startup',
  platform: `${process.platform}-${process.arch}`,
  medianWindowLoadedMs: median(samples.map((sample) => sample.windowLoadedMs)),
  medianWorkingSetKB: median(samples.map((sample) => sample.workingSetKB)),
  samples,
};
if (process.argv[2]) {
  const output = path.resolve(process.argv[2]);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
