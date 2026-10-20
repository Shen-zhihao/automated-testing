import { analyzeDocument, complete } from './model.mjs';

export class WorkspaceService {
  constructor({ store, settings, feishu, parseFile, notify = () => {}, fetchImpl }) {
    Object.assign(this, { store, settings, feishu, parseFile, notify, fetchImpl });
    this.jobs = new Map();
    this.controllers = new Map();
    this.importing = false;
  }
  snapshot() {
    return {
      settings: this.settings.public(),
      documents: this.store.listDocuments(),
      jobs: Object.fromEntries(this.jobs),
      importing: this.importing,
      feishu: this.feishu.status(),
    };
  }
  async importFiles(paths) {
    if (this.importing) throw new Error('正在导入，请稍候。');
    if (paths.length > 10) throw new Error('每次最多导入 10 个文件。');
    this.importing = true;
    this.notify();
    const imported = [],
      errors = [];
    try {
      for (const file of paths) {
        try {
          imported.push(this.store.addDocument(await this.parseFile(file)).id);
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
  async importFeishu(url) {
    if (this.importing) throw new Error('正在导入，请稍候。');
    this.importing = true;
    this.notify();
    try {
      return this.store.addDocument(await this.feishu.read(url)).id;
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
    });
    return `连接成功，模型 ${config.model} 已返回文本。`;
  }
  async analyze(id, goal) {
    if (this.controllers.has(id)) throw new Error('此文档正在分析。');
    if (this.controllers.size >= 2) throw new Error('同时最多分析两份文档，请等待已有任务完成。');
    const document = this.store.getDocument(id);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const update = (status, message) => {
      this.jobs.set(id, { status, message });
      this.notify();
    };
    update('running', '正在准备分析');
    try {
      const config = await this.settings.modelConfig();
      const analysis = await analyzeDocument(document, goal, config, {
        signal: controller.signal,
        fetchImpl: this.fetchImpl,
        onProgress: (message) => update('running', message),
      });
      controller.signal.throwIfAborted();
      this.store.saveAnalysis(id, analysis);
      update('complete', '分析完成，已保存到本机');
      return analysis;
    } catch (error) {
      const message = controller.signal.aborted ? '分析已取消，原有分析结果保留。' : error.message;
      update(controller.signal.aborted ? 'cancelled' : 'error', message);
      throw new Error(message);
    } finally {
      this.controllers.delete(id);
      this.notify();
    }
  }
  cancel(id) {
    this.controllers.get(id)?.abort();
  }
  remove(id) {
    if (this.controllers.has(id)) throw new Error('请先取消正在进行的分析。');
    this.store.deleteDocument(id);
    this.jobs.delete(id);
    this.notify();
  }
  cancelAll() {
    for (const controller of this.controllers.values()) controller.abort();
  }
}
