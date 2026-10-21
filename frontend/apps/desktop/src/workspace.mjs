import { analyzeDocument, complete, validateAnalysisGoal } from './model.mjs';
import { DEFAULT_PROJECT_ID } from './projects.mjs';
import { ProjectFiles } from './project-files.mjs';

export class WorkspaceService {
  constructor({
    store,
    settings,
    feishu,
    parseFile,
    notify = () => {},
    fetchImpl,
    storage,
    testing,
    projectBrowser,
  }) {
    Object.assign(this, {
      store,
      settings,
      feishu,
      parseFile,
      notify,
      fetchImpl,
      storage,
      testing,
    });
    this.jobs = new Map();
    this.controllers = new Map();
    this.analysisOperations = new Map();
    this.goalUpdates = new Map();
    this.analysisEpoch = 0;
    this.importing = false;
    this.refreshingId = null;
    this.projectLocks = new Set();
    this.projectOperations = new Map();
    this.projectFiles = new ProjectFiles(this, projectBrowser);
  }
  async runProject(projectId, operation) {
    this.store.projects.get(projectId);
    if (this.projectLocks.has(projectId)) throw new Error('工程正在清理，请稍后再试。');
    this.projectOperations.set(projectId, (this.projectOperations.get(projectId) || 0) + 1);
    try {
      return await operation();
    } finally {
      const count = this.projectOperations.get(projectId) - 1;
      if (count) this.projectOperations.set(projectId, count);
      else this.projectOperations.delete(projectId);
    }
  }
  assertProjectIdle(projectId) {
    this.store.projects.get(projectId);
    if (
      this.projectLocks.has(projectId) ||
      this.projectOperations.has(projectId) ||
      this.importing ||
      this.terminal?.running.has(projectId) ||
      [...(this.terminal?.reviews.values() || [])].some((review) => review.projectId === projectId)
    )
      throw new Error('请等待当前工程的导入、保存或其他操作完成后再清理。');
    const docs = new Set(this.store.listDocuments(projectId).map((doc) => doc.id));
    const jobs = this.testing?.snapshot(projectId).testJobs || {};
    if (
      [...this.controllers.keys()].some((id) => docs.has(id)) ||
      Object.values(jobs).some((job) => job.status === 'running')
    )
      throw new Error('工程有运行中的分析、对话或测试，请先停止或等待完成。');
  }
  snapshot(projectId) {
    const projects = this.store.projects.list();
    // undefined retains the legacy default; null explicitly asks for global metadata only.
    if (projectId === undefined) projectId = projects[0]?.id || null;
    if (projectId) this.store.projects.get(projectId);
    const documents = projectId ? this.store.listDocuments(projectId) : [];
    const documentIds = new Set(documents.map((document) => document.id));
    return {
      projects,
      activeProjectId: projectId,
      settings: this.settings.public(),
      documents,
      jobs: Object.fromEntries([...this.jobs].filter(([id]) => documentIds.has(id))),
      importing: this.importing,
      feishu: this.feishu.status(),
      storage: this.storage?.info(),
      ...((projectId && this.testing?.snapshot(projectId)) || {
        testSessions: [],
        testTasks: [],
        testJobs: {},
      }),
    };
  }
  async importFiles(paths, projectId = DEFAULT_PROJECT_ID) {
    this.store.projects.get(projectId);
    if (this.importing) throw new Error('正在导入，请稍候。');
    if (paths.length > 10) throw new Error('每次最多导入 10 个文件。');
    this.importing = true;
    this.notify();
    const imported = [],
      errors = [];
    try {
      for (const file of paths) {
        try {
          imported.push(this.store.addDocument({ ...(await this.parseFile(file)), projectId }).id);
        } catch (error) {
          errors.push({ name: file.split(/[\\/]/).pop(), message: error.message });
        }
        this.notify();
      }
      return { imported, errors };
    } finally {
      this.importing = false;
      this.notify();
    }
  }
  async importFeishu(url, projectId = DEFAULT_PROJECT_ID) {
    this.store.projects.get(projectId);
    if (this.importing) throw new Error('正在导入，请稍候。');
    this.importing = true;
    this.notify();
    try {
      return this.store.addDocument({ ...(await this.feishu.read(url)), projectId }).id;
    } finally {
      this.importing = false;
      this.notify();
    }
  }
  async testModel() {
    const config = await this.settings.modelConfig();
    await complete(config, [{ role: 'user', content: '连接测试，请只回复 OK。' }], {
      fetchImpl: this.fetchImpl,
      maxTokens: Math.min(config.maxTokens, 2048),
      reasoningEffort: 'none',
    });
    return `连接成功，模型 ${config.model} 已返回文本。`;
  }
  async refreshDocument(id) {
    if (this.importing || this.controllers.has(id)) throw new Error('请等待导入或分析完成后重试。');
    const previous = this.store.getDocument(id);
    this.importing = true;
    this.refreshingId = id;
    this.notify();
    try {
      const source =
        previous.kind === 'feishu'
          ? await this.feishu.read(previous.source)
          : await this.parseFile(previous.source);
      const updated = this.store.updateDocumentSource(id, source);
      if (updated.content !== previous.content) this.jobs.delete(id);
      return { document: updated, contentChanged: updated.content !== previous.content };
    } finally {
      this.importing = false;
      this.refreshingId = null;
      this.notify();
    }
  }
  async analyze(id, goal) {
    if (this.refreshingId === id) throw new Error('正在重新提取原文，请完成后再分析。');
    if (this.controllers.has(id)) throw new Error('此文档正在分析。');
    if (this.controllers.size >= 2) throw new Error('同时最多分析两份文档，请等待已有任务完成。');
    goal = validateAnalysisGoal(goal);
    const operation = this.performAnalysis(id, goal);
    this.analysisOperations.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.analysisOperations.get(id) === operation) this.analysisOperations.delete(id);
    }
  }
  async reviseAnalysis(id, goal) {
    goal = validateAnalysisGoal(goal);
    if (this.goalUpdates.has(id)) throw new Error('正在应用补充要求，请稍候。');
    if (this.controllers.has(id) && this.jobs.get(id)?.goal === goal) return;
    const document = this.store.getDocument(id);
    const update = { cancelled: false, epoch: this.analysisEpoch };
    this.goalUpdates.set(id, update);
    try {
      const previous = this.analysisOperations.get(id);
      this.controllers.get(id)?.abort();
      await previous?.catch(() => {});
      if (update.cancelled || update.epoch !== this.analysisEpoch)
        throw new Error('应用补充要求已取消，已生成内容保留。');
      // 修订接口立即返回；后台任务仍占用存储与工程操作锁，迁移或清理需等它结束。
      const operation = this.runProject(document.projectId, () =>
        this.storage ? this.storage.run(() => this.analyze(id, goal)) : this.analyze(id, goal),
      );
      void operation.catch(() => {}); // 错误通过 job 状态呈现，不产生未处理拒绝。
    } finally {
      if (this.goalUpdates.get(id) === update) this.goalUpdates.delete(id);
    }
  }
  async performAnalysis(id, goal) {
    const document = this.store.getDocument(id);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    let revision = this.jobs.get(id)?.revision ?? 0;
    const update = (status, message) => {
      this.jobs.set(id, { status, message, goal, revision });
      this.notify();
    };
    update('running', '正在准备拆分需求');
    try {
      const config = await this.settings.modelConfig();
      const analysis = await analyzeDocument(document, goal, config, {
        signal: controller.signal,
        fetchImpl: this.fetchImpl,
        onProgress: (message) => update('running', message),
        checkpoint: this.store.readAnalysisCheckpoint(id),
        onCheckpoint: (value) => {
          this.store.saveAnalysisCheckpoint(id, value);
          revision++;
          update('running', this.jobs.get(id)?.message ?? '正在生成');
        },
      });
      controller.signal.throwIfAborted();
      this.store.saveAnalysis(id, analysis);
      update('complete', '实施与验收文档已生成，已保存到本机，可另存为 Markdown');
      return analysis;
    } catch (error) {
      const reason = controller.signal.aborted ? '分析已取消，原有分析结果保留。' : error.message;
      const message = this.store.analysisDraft(id)
        ? `${reason} 已保存生成进度，保持补充要求和模型不变可继续生成。`
        : reason;
      update(controller.signal.aborted ? 'cancelled' : 'error', message);
      throw new Error(message);
    } finally {
      this.controllers.delete(id);
      this.notify();
    }
  }
  cancel(id) {
    const update = this.goalUpdates.get(id);
    if (update) update.cancelled = true;
    this.controllers.get(id)?.abort();
  }
  remove(id) {
    if (this.refreshingId === id) throw new Error('正在重新提取原文，请完成后再移除。');
    if (this.controllers.has(id)) throw new Error('请先取消正在进行的分析。');
    this.store.deleteDocument(id);
    this.jobs.delete(id);
    this.notify();
  }
  cancelAll() {
    this.analysisEpoch++;
    this.testing?.close();
    for (const controller of this.controllers.values()) controller.abort();
  }
}
