import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, lstat, realpath, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { commandTokens, inspectCommand, defaultShell } from './policy.mjs';
import { executeCommand } from './runner.mjs';
import { reviewAgentScope } from '../model.mjs';

const stamp = () => new Date().toISOString();
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const outputLimit = 128 * 1024;
export class TerminalService {
  constructor(
    workspace,
    { root, execute = executeCommand, platform = process.platform, shell = defaultShell(platform) },
  ) {
    Object.assign(this, { workspace, root, execute, platform, shell });
    this.store = workspace.store;
    this.running = new Map();
    this.reviews = new Map();
    this.changes = new EventEmitter();
    this.closing = false;
    for (const row of this.store.db
      .prepare(
        "SELECT data FROM command_runs WHERE json_extract(data, '$.status') IN ('running', 'reviewing', 'pending')",
      )
      .all()) {
      const run = JSON.parse(row.data);
      this.save({
        ...run,
        status: 'interrupted',
        finishedAt: stamp(),
        error: '应用已退出，本次命令未确认完成。',
      });
    }
  }
  directory(id) {
    return path.join(this.root, createHash('sha256').update(id).digest('hex').slice(0, 32));
  }
  async ensureDirectory(id) {
    this.store.projects.get(id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (
      (await lstat(directory)).isSymbolicLink() ||
      path.dirname(await realpath(directory)) !== (await realpath(this.root))
    )
      throw new Error('工程工作目录不可链接到其他位置。');
    return directory;
  }
  info(id) {
    this.store.projects.get(id);
    return {
      execution: 'background',
      shell: this.shell,
      directory: this.directory(id),
      platform: this.platform,
    };
  }
  list(id) {
    this.store.projects.get(id);
    return this.store.db
      .prepare(
        `SELECT json_remove(json_set(data, '$.output', substr(json_extract(data, '$.output'), -500)), '$.fingerprint') AS data
        FROM command_runs WHERE project_id=? ORDER BY created_at DESC, id DESC LIMIT 100`,
      )
      .all(id)
      .map((row) => {
        const run = JSON.parse(row.data);
        // SQLite counts Unicode code points; preserve the public 500 UTF-16-unit limit.
        return { ...run, output: run.output.slice(-500) };
      });
  }
  publicRun(id, runId) {
    const { fingerprint: _hash, ...run } = this.get(id, runId);
    return run;
  }
  get(id, runId) {
    const row = this.store.db
      .prepare('SELECT data FROM command_runs WHERE id=? AND project_id=?')
      .get(runId, id);
    if (!row) throw new Error('命令不属于当前工程或已清理。');
    return JSON.parse(row.data);
  }
  save(run) {
    this.store.db
      .prepare('INSERT OR REPLACE INTO command_runs VALUES (?, ?, ?, ?)')
      .run(run.id, run.projectId, run.createdAt, JSON.stringify(run));
    this.workspace.notify();
    this.changes.emit(run.id);
    return run;
  }
  wait(id, runId, signal) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.changes.off(runId, update);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        this.stop(id);
        reject(signal.reason || new Error('命令已停止。'));
      };
      const update = () => {
        try {
          const run = this.publicRun(id, runId);
          if (!['pending', 'reviewing', 'running'].includes(run.status)) {
            cleanup();
            resolve(run);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      this.changes.on(runId, update);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else update();
    });
  }
  async propose(id, { command, reason, sessionId = null }, { signal } = {}) {
    this.store.projects.get(id);
    if (this.closing || this.workspace.projectLocks.has(id))
      throw new Error('工程正在关闭或清理，暂不能创建命令。');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000)
      throw new Error('请说明命令与当前工程需求或验收的关系。');
    if (sessionId) this.store.projects.assertResource(id, 'chat', sessionId);
    const run = {
      id: randomUUID(),
      projectId: id,
      sessionId,
      command: typeof command === 'string' ? command.slice(0, 2000) : '',
      reason: reason.trim(),
      cwd: this.directory(id),
      shell: this.shell,
      status: 'reviewing',
      output: '',
      truncated: false,
      error: '',
      exitCode: null,
      createdAt: stamp(),
      startedAt: null,
      finishedAt: null,
    };
    this.save(run);
    const controller = new AbortController();
    const operationSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const completed = Promise.withResolvers();
    this.reviews.set(run.id, { projectId: id, controller, done: completed.promise });
    try {
      operationSignal.throwIfAborted();
      commandTokens(command);
      await this.ensureDirectory(id);
      const checked = await inspectCommand(command, run.cwd);
      const config = await this.workspace.settings.modelConfig();
      const project = this.store.projects.get(id),
        documents = this.store.listDocuments(id);
      const request = sessionId
        ? this.workspace.testing.db
            .session(sessionId)
            .messages.filter((message) => message.role === 'user')
            .at(-1)?.content || ''
        : run.reason;
      const decision = await reviewAgentScope(
        config,
        {
          kind: 'command',
          project,
          documents: documents.map(({ name }) => name),
          command,
          reason: run.reason,
          request,
          files: checked.files,
        },
        { fetchImpl: this.workspace.fetchImpl, signal: operationSignal },
      );
      operationSignal.throwIfAborted();
      if (decision !== 'allow')
        throw new Error('命令与工程无关、存在风险或依据不足，安全审查未放行。');
      run.fingerprint = fingerprint(checked);
      run.status = 'pending';
      run.autoApproved = true;
      this.save(run);
      this.drain();
    } catch (error) {
      run.status = operationSignal.aborted ? 'cancelled' : 'blocked';
      run.error = operationSignal.aborted ? '命令已停止。' : error.message;
      run.finishedAt = stamp();
      this.save(run);
    } finally {
      this.reviews.delete(run.id);
      completed.resolve();
    }
    return this.publicRun(id, run.id);
  }
  drain() {
    if (this.closing) return;
    for (const { project_id: id, id: runId } of this.store.db
      .prepare(
        "SELECT project_id, id FROM command_runs WHERE json_extract(data, '$.status')='pending' AND json_extract(data, '$.autoApproved')=1 ORDER BY created_at, id",
      )
      .all()) {
      if (this.running.size >= 3) return;
      if (this.running.has(id) || this.workspace.projectLocks.has(id)) continue;
      this.start(id, runId);
    }
  }
  start(id, runId) {
    if (this.closing || this.workspace.projectLocks.has(id))
      throw new Error('工程正在清理或关闭，命令未执行。');
    const run = this.get(id, runId);
    if (run.status !== 'pending' || !run.autoApproved)
      throw new Error('只有已通过检查的排队命令可以执行，已完成命令请重新创建。');
    if (this.running.has(id)) throw new Error('本工程已有运行中的命令，请等待完成或停止。');
    if (this.running.size >= 3) throw new Error('同时最多执行三个工程命令。');
    run.status = 'running';
    run.startedAt = stamp();
    run.execution = 'background';
    this.save(run);
    const entry = { stop: null, done: null, cancelled: false };
    this.running.set(id, entry);
    const operation = () =>
      this.workspace.runProject(id, async () => {
        let flushTimer;
        try {
          const directory = await this.ensureDirectory(id),
            checked = await inspectCommand(run.command, directory);
          if (fingerprint(checked) !== run.fingerprint)
            throw new Error('待执行脚本或配置已变化，请重新提交审查。');
          if (entry.cancelled) {
            run.status = 'cancelled';
            return;
          }
          const worker = this.execute({
            shell: this.shell,
            tokens: checked.tokens,
            cwd: directory,
            platform: this.platform,
            onOutput: (chunk) => {
              const clean = chunk
                .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
                .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
              if (run.output.length + clean.length > outputLimit) run.truncated = true;
              run.output = (run.output + clean).slice(-outputLimit);
              if (!flushTimer)
                flushTimer = setTimeout(() => {
                  flushTimer = null;
                  this.save(run);
                }, 200);
            },
          });
          entry.stop = worker.stop;
          if (entry.cancelled) worker.stop();
          const result = await worker.done;
          run.exitCode = result.code;
          run.status = result.cancelled
            ? 'cancelled'
            : result.timedOut
              ? 'timed-out'
              : result.code === 0 && !result.error
                ? 'passed'
                : 'failed';
          run.error = result.error || (result.timedOut ? '命令超过 120 秒，已停止。' : '');
        } catch (error) {
          run.status = 'blocked';
          run.error = error.message;
        } finally {
          clearTimeout(flushTimer);
          run.finishedAt = stamp();
          this.save(run);
          this.running.delete(id);
          this.workspace.notify();
          this.drain();
        }
      });
    entry.done = (
      this.workspace.storage ? this.workspace.storage.run(operation) : operation()
    ).catch((error) => {
      this.save({ ...run, status: 'blocked', error: error.message, finishedAt: stamp() });
      this.running.delete(id);
    });
  }
  stop(id) {
    this.store.projects.get(id);
    for (const { id: runId } of this.store.db
      .prepare(
        "SELECT id FROM command_runs WHERE project_id=? AND json_extract(data, '$.status')='pending'",
      )
      .all(id))
      this.save({
        ...this.get(id, runId),
        autoApproved: false,
        status: 'cancelled',
        finishedAt: stamp(),
        error: '命令队列已停止。',
      });
    for (const review of this.reviews.values())
      if (review.projectId === id) review.controller.abort();
    const entry = this.running.get(id);
    if (entry) {
      entry.cancelled = true;
      entry.stop?.();
    }
  }
  async size(id) {
    let bytes = 0;
    const scan = async (directory) => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) await scan(file);
        else if (item.isFile()) bytes += (await lstat(file)).size;
      }
    };
    try {
      if (!(await lstat(this.directory(id))).isSymbolicLink()) await scan(this.directory(id));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return bytes;
  }
  async clearFiles(id) {
    if (this.running.has(id)) throw new Error('请先停止本工程命令。');
    await rm(this.directory(id), { recursive: true, force: true });
    this.store.db.prepare('DELETE FROM command_runs WHERE project_id=?').run(id);
  }
  async close() {
    this.closing = true;
    const reviews = [...this.reviews.values()];
    for (const { controller } of reviews) controller.abort();
    const projects = new Set([
      ...this.running.keys(),
      ...[...this.reviews.values()].map((review) => review.projectId),
      ...this.store.db
        .prepare(
          "SELECT DISTINCT project_id FROM command_runs WHERE json_extract(data, '$.status')='pending'",
        )
        .all()
        .map((row) => row.project_id),
    ]);
    for (const id of projects) this.stop(id);
    await Promise.allSettled([
      ...reviews.map((review) => review.done),
      ...[...this.running.values()].map((entry) => entry.done),
    ]);
  }
}
