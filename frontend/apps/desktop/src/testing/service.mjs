import { TestingStore, extractFeatures, newId, now } from './store.mjs';
import {
  answerChat,
  generateTestDocument,
  parseChatReply,
  renderTestDocument,
  textField,
} from './model.mjs';
import {
  executePlan,
  planBrowserTests,
  testUrl,
  validatePlan,
  redact,
  redactObject,
} from './automation.mjs';
import { browserAddress } from './browser-policy.mjs';
import { BrowserDataService } from '../browser-data/service.mjs';
import { BrowserRetention } from './browser-retention.mjs';
import { DEFAULT_PROJECT_ID } from '../projects.mjs';
import { testGenerationView } from './generation.mjs';
import { runWorkflow, runTool } from '../mastra/runtime.mjs';

export class TestingService {
  constructor({
    store,
    settings,
    notify = () => {},
    notifyBrowser = notify,
    fetchImpl,
    browserFactory,
  }) {
    Object.assign(this, { store, settings, notify, notifyBrowser, fetchImpl, browserFactory });
    this.db = new TestingStore(store);
    this.browserData = new BrowserDataService(store, settings.vault);
    this.jobs = new Map();
    this.controllers = new Map();
    this.browsers = new Map();
    this.browserUses = new Set();
    this.retiredBrowsers = new Set();
    this.retention = new BrowserRetention(this.browsers, {
      isBusy: (id) =>
        this.controllers.has(`task:${id}`) ||
        this.browserUses.has(id) ||
        Boolean(this.browsers.get(id)?.downloads?.size),
      onRetire: (id) => {
        if (!id.startsWith('page:')) this.retiredBrowsers.add(id);
        if (this.retiredBrowsers.size > 200)
          this.retiredBrowsers.delete(this.retiredBrowsers.values().next().value);
        this.notifyBrowser();
      },
    });
    this.db.recoverInterrupted();
  }
  features(id) {
    return extractFeatures(this.store.getDocument(id).analysis?.content || '');
  }
  snapshot(projectId = DEFAULT_PROJECT_ID) {
    const testSessions = this.db.sessionSummaries(projectId),
      testTasks = this.db.taskSummaries(projectId);
    const keys = new Set([
      ...testSessions.map((item) => `chat:${item.id}`),
      ...testTasks.map((item) => `task:${item.id}`),
    ]);
    return {
      testSessions,
      testTasks,
      testJobs: Object.fromEntries([...this.jobs].filter(([key]) => keys.has(key))),
    };
  }
  sourceState(id) {
    return this.db.sourceReference(id);
  }
  getSession(id) {
    const session = this.db.session(id);
    const references = new Map();
    const reference = (sourceId) => {
      if (!references.has(sourceId)) references.set(sourceId, this.sourceState(sourceId));
      return references.get(sourceId);
    };
    return {
      ...session,
      source: session.sourceId ? reference(session.sourceId) : null,
      messages: session.messages.map((message) => ({
        ...message,
        content:
          message.role === 'assistant' ? parseChatReply(message.content).content : message.content,
        references: (message.sourceIds ?? (session.sourceId ? [session.sourceId] : [])).map(
          reference,
        ),
      })),
    };
  }
  getTask(id) {
    const { documentCheckpoint, planCheckpoint, ...task } = this.db.task(id);
    return {
      ...task,
      documentDraft: testGenerationView(documentCheckpoint),
      planDraft: testGenerationView(planCheckpoint),
      source: this.sourceState(task.sourceId),
      runs: this.db.runs(id),
      browserOpen: Boolean(this.browsers.get(id)?.alive()),
      reportStale: Boolean(task.report && task.report.revision !== task.revision),
    };
  }
  assertIdle(key) {
    if (this.controllers.has(key)) throw new Error('当前操作尚未完成，请等待或取消。');
  }
  async job(key, kind, operation) {
    this.assertIdle(key);
    if (this.controllers.size >= 3) throw new Error('同时最多进行三个操作，请稍后重试。');
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const progress = (message) => {
      this.jobs.set(key, {
        status: 'running',
        kind,
        message,
        revision: this.jobs.get(key)?.revision ?? 0,
      });
      this.notify();
    };
    progress('正在准备…');
    try {
      const value = await operation(controller.signal, progress);
      controller.signal.throwIfAborted();
      this.jobs.set(key, { status: 'complete', kind, message: '已完成并保存在本机。' });
      return value;
    } catch (error) {
      const browser = key.startsWith('task:') ? this.browsers.get(key.slice(5)) : null;
      let message = controller.signal.aborted
        ? '操作已取消，已有结果保留。'
        : redact(error.message || '操作失败', browser?.secrets).slice(0, 1000);
      if (key.startsWith('task:') && ['document', 'plan'].includes(kind)) {
        const task = this.db.task(key.slice(5));
        if (testGenerationView(task[kind === 'document' ? 'documentCheckpoint' : 'planCheckpoint']))
          message += ' 已保存生成进度，保持任务与模型不变可继续生成。';
      }
      this.jobs.set(key, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        kind,
        message,
      });
      throw new Error(message);
    } finally {
      this.controllers.delete(key);
      this.retention.reap();
      this.notify();
    }
  }
  cancel(key) {
    this.controllers.get(key)?.abort();
  }
  saveGeneration(task, field, checkpoint, secrets = []) {
    // 页面中可能包含已知敏感值，草稿与最终计划使用相同的脱敏边界。
    task[field] = redactObject(structuredClone(checkpoint), secrets);
    this.db.saveTask(task);
    const key = `task:${task.id}`;
    const job = this.jobs.get(key);
    if (job) this.jobs.set(key, { ...job, revision: (job.revision ?? 0) + 1 });
    this.notify();
  }
  close() {
    this.retention.dispose();
    this.retiredBrowsers.clear();
    for (const controller of this.controllers.values()) controller.abort();
    for (const browser of this.browsers.values()) browser.close();
    this.browsers.clear();
  }
  closeProjectBrowsers(projectId) {
    for (const task of this.db.taskSummaries(projectId)) this.retiredBrowsers.delete(task.id);
    for (const [id, browser] of this.browsers)
      if (browser.projectId === projectId) {
        this.retention.forget(id);
        this.browsers.delete(id);
        this.retiredBrowsers.delete(id);
        browser.close();
      }
    this.notifyBrowser();
  }
  browserInfo(id) {
    return (
      this.browsers.get(id)?.info() || {
        open: false,
        url: '',
        title: '新标签页',
        loading: false,
        error: '',
        canGoBack: false,
        canGoForward: false,
      }
    );
  }
  attachBrowser(id, parent, bounds) {
    const browser = this.browsers.get(id);
    if (!browser?.alive() || (bounds && !browser.visible)) return;
    if (bounds)
      for (const [key, value] of this.browsers)
        if (key !== id && value.alive()) value.attach(parent, null);
    browser.attach(parent, bounds);
  }
  navigateBrowser(id, action) {
    this.assertIdle(`task:${id}`);
    if (!['back', 'forward', 'reload', 'stop'].includes(action))
      throw new Error('浏览器操作无效。');
    this.browsers.get(id)?.navigate(action);
  }
  browserTabs() {
    return [...this.browsers]
      .filter(([, browser]) => browser.alive() && browser.visible)
      .map(([id, browser]) => ({
        id,
        projectId: browser.projectId || null,
        parentId: browser.parentId || null,
        ...browser.info(),
      }));
  }
  hideBrowser(id) {
    const browser = this.browsers.get(id);
    if (!browser?.alive()) return;
    browser.visible = false;
    browser.attach(null, null);
    this.retention.hide(id);
    this.notifyBrowser();
  }
  loadBrowser(id, url) {
    this.assertIdle(`task:${id}`);
    const browser = this.browsers.get(id);
    if (!browser?.alive()) throw new Error('网页已关闭，请重新打开。');
    browser.browse(browserAddress(url));
  }
  async fillBrowserPassword(id, passwordId) {
    this.assertIdle(`task:${id}`);
    this.browserUses.add(id);
    try {
      await this.browserData.fill(this.browsers.get(id), passwordId);
    } finally {
      this.browserUses.delete(id);
    }
  }
  makeBrowser(id, url, options = {}) {
    if (!this.browserFactory) throw new Error('当前环境没有桌面浏览器。');
    let browser;
    browser = this.browserFactory(url, {
      webPreferences: options.webPreferences,
      webContents: options.webContents,
      projectId: options.projectId,
      onChanged: () => {
        if (browser && !browser.alive() && this.browsers.get(id) === browser) {
          this.browsers.delete(id);
          this.retention.forget(id);
        }
        this.notifyBrowser();
      },
      onPopup: (target, popupOptions) => {
        const popup = this.makeBrowser(`page:${newId()}`, target, {
          ...popupOptions,
          projectId: browser.projectId,
        });
        popup.parentId = id;
        popup.projectId = browser.projectId;
        this.notifyBrowser();
        return popup;
      },
    });
    this.browsers.set(id, browser);
    this.retiredBrowsers.delete(id);
    return browser;
  }
  createSession(input = {}) {
    let source = null,
      task = null;
    if (input.taskId) {
      task = this.db.task(input.taskId);
      source = this.db.source(task.sourceId);
    } else if (input.documentId)
      source = this.db.snapshot(this.store.getDocument(input.documentId), {
        requireAnalysis: false,
      });
    const projectId = input.projectId || source?.projectId || DEFAULT_PROJECT_ID;
    this.store.projects.get(projectId);
    if (source && projectId !== source.projectId) throw new Error('需求不属于当前工程。');
    const featureId = task?.featureId || input.featureId || '';
    if (featureId && !source?.features.some((feature) => feature.id === featureId))
      throw new Error('此分析中不存在所选功能，请重新选择。');
    const feature = source?.features.find((item) => item.id === featureId);
    const value = this.db.saveSession({
      id: newId(),
      projectId,
      title: task?.name || feature?.title || (source ? `${source.name} · 测试讨论` : '新对话'),
      sourceId: source?.id || null,
      featureId,
      taskId: task?.id || null,
      createdAt: now(),
      updatedAt: now(),
      messages: [],
    });
    this.notify();
    return this.getSession(value.id);
  }
  renameSession(id, title) {
    this.assertIdle(`chat:${id}`);
    const session = this.db.session(id);
    this.db.saveSession({ ...session, title: textField(title, '对话名称', 160), updatedAt: now() });
    this.notify();
    return this.getSession(id);
  }
  deleteSession(id) {
    const key = `chat:${id}`;
    this.assertIdle(key);
    this.db.deleteSession(id);
    this.jobs.delete(key);
    this.notify();
  }
  async sendMessage(id, content, documentIds) {
    const text = textField(content, '消息', 12000);
    if (
      documentIds !== undefined &&
      (!Array.isArray(documentIds) ||
        documentIds.length > 5 ||
        documentIds.some((documentId) => typeof documentId !== 'string' || !documentId))
    )
      throw new Error('每轮最多引用 5 份文档。');
    return this.job(`chat:${id}`, 'chat', async (signal, progress) => {
      const session = this.db.session(id);
      const documents = [...new Set(documentIds || [])].map((documentId) => {
        const document = this.store.getDocument(documentId);
        if (document.projectId !== session.projectId) throw new Error('引用文档不属于当前工程。');
        return document;
      });
      const config = await this.settings.modelConfig();
      signal.throwIfAborted();
      const sources =
        documentIds === undefined
          ? session.sourceId
            ? [this.db.source(session.sourceId)]
            : []
          : documents.map((document) => this.db.snapshot(document, { requireAnalysis: false }));
      const sourceIds = sources.map((source) => source.id);
      const source = {
        references: sources,
        project: this.store.projects.get(session.projectId),
        projectDocuments: this.store
          .listDocuments(session.projectId)
          .map(({ name, analyzed }) => ({ name, analyzed })),
      };
      if (!session.messages.length && session.title === '新对话')
        session.title = text.replace(/\s+/g, ' ').slice(0, 60);
      session.messages.push({
        id: newId(),
        role: 'user',
        content: text,
        createdAt: now(),
        status: 'complete',
        sourceIds,
      });
      session.updatedAt = now();
      this.db.saveSession(session);
      progress(sources.length ? '正在结合引用资料与讨论回答…' : '正在回答…');
      const commandIds = [];
      try {
        if (session.taskId) {
          const task = this.db.task(session.taskId);
          session.taskContext = {
            name: task.name,
            scope: task.scope,
            sourceId: task.sourceId,
            notes: task.notes,
            cases: task.report?.cases ?? [],
            reportStale: Boolean(task.report && task.report.revision !== task.revision),
            recentRuns: this.db.recentRunSummaries(task.id),
          };
        }
        if (this.terminal)
          session.commandContext = {
            ...this.terminal.info(session.projectId),
            recentCommands: this.terminal
              .list(session.projectId)
              .filter((run) => run.sessionId === id)
              .slice(0, 4)
              .map((run) => ({
                command: run.command,
                status: run.status,
                exitCode: run.exitCode,
                output: redact(run.output, [config.apiKey]),
                error: redact(run.error, [config.apiKey]),
              })),
          };
        const answer = await runWorkflow(
          'chat-turn',
          {
            answer: () =>
              answerChat(source, session, config, {
                signal,
                fetchImpl: this.fetchImpl,
              }),
            'execute-commands': async (answer) => {
              if (!this.terminal || !answer.commands?.length) return { answer, results: [] };
              for (const proposal of answer.commands) {
                await runTool(
                  'project-command',
                  proposal,
                  async (input) => {
                    const run = await this.terminal.propose(
                      session.projectId,
                      { ...input, sessionId: id },
                      { signal },
                    );
                    // 先记录已提交的命令，取消发生在工具返回时也能停止它。
                    commandIds.push(run.id);
                    return { id: run.id };
                  },
                  { signal },
                );
              }
              progress('正在后台执行工程命令…');
              const results = await Promise.all(
                commandIds.map((runId) => this.terminal.wait(session.projectId, runId, signal)),
              );
              return { answer, results };
            },
            summarize: ({ answer, results }) => {
              if (!results.length) return answer;
              progress('正在整理命令执行结果…');
              return answerChat(
                source,
                {
                  ...session,
                  commandResults: results.map((run) => ({
                    command: run.command,
                    status: run.status,
                    exitCode: run.exitCode,
                    output: redact(run.output, [config.apiKey]),
                    truncated: run.truncated,
                    error: redact(run.error, [config.apiKey]),
                  })),
                },
                config,
                { signal, fetchImpl: this.fetchImpl },
              );
            },
          },
          { signal },
        );
        const latest = this.db.session(id);
        latest.messages.push({
          id: newId(),
          role: 'assistant',
          commandIds,
          refused: Boolean(answer.refused),
          content: answer.content,
          excerpts: answer.excerpts,
          contextUsage: answer.contextUsage,
          sourceIds,
          createdAt: now(),
          status: 'complete',
        });
        latest.updatedAt = now();
        this.db.saveSession(latest);
        return this.getSession(id);
      } catch (error) {
        if (signal.aborted && commandIds.length) this.terminal?.stop(session.projectId);
        const latest = this.db.session(id);
        latest.messages.push({
          id: newId(),
          role: 'assistant',
          commandIds,
          content: signal.aborted
            ? '回答已取消，可继续提问。'
            : commandIds.length
              ? '后台命令已有执行记录，本次结果整理失败，可展开记录查看。'
              : '本次回答失败，请重试。',
          createdAt: now(),
          status: 'error',
          sourceIds,
        });
        latest.updatedAt = now();
        this.db.saveSession(latest);
        throw error;
      }
    });
  }
  createTask(input, retainedSourceId) {
    const session = input.sessionId ? this.db.session(input.sessionId) : null;
    const sourceId = retainedSourceId || session?.sourceId;
    if (session && !sourceId) throw new Error('请引用需求文档后，再将回复保留到测试任务。');
    const source = sourceId
      ? this.db.source(sourceId)
      : this.db.snapshot(this.store.getDocument(input.documentId));
    if (session && session.projectId !== source.projectId) throw new Error('需求不属于当前工程。');
    if (input.projectId && input.projectId !== source.projectId)
      throw new Error('需求不属于当前工程。');
    const featureId =
      retainedSourceId && retainedSourceId !== session?.sourceId
        ? ''
        : session?.featureId || input.featureId || '';
    const feature = source.features.find((item) => item.id === featureId);
    if (featureId && !feature) throw new Error('功能编号与需求分析不匹配。');
    const name = textField(input.name || feature?.title || source.name, '任务名称', 160);
    const task = this.db.saveTask({
      id: newId(),
      projectId: source.projectId,
      name,
      scope: textField(
        input.scope || feature?.title || '覆盖所选需求的全部功能、关键交互与异常恢复',
        '测试范围',
        4000,
      ),
      sourceId: source.id,
      featureId,
      sessionId: session?.id || null,
      notes: [],
      revision: 1,
      report: null,
      reportHistory: [],
      plan: null,
      url: '',
      createdAt: now(),
      updatedAt: now(),
    });
    if (session) this.db.saveSession({ ...session, taskId: task.id, updatedAt: now() });
    this.notify();
    return this.getTask(task.id);
  }
  keepMessage(sessionId, messageId, taskId) {
    const session = this.db.session(sessionId);
    const message = session.messages.find(
      (item) => item.id === messageId && item.role === 'assistant' && item.status === 'complete',
    );
    if (!message || message.refused) throw new Error('只能保留已完成且与工程相关的助手回复。');
    const sourceId = message.sourceIds?.[0] || (message.sourceIds ? null : session.sourceId);
    if (!sourceId) throw new Error('此回复未引用需求文档，请引用文档后重新提问。');
    let task;
    const associated = session.taskId ? this.db.task(session.taskId) : null;
    const target = taskId ?? (associated?.sourceId === sourceId ? associated.id : null);
    if (target) {
      this.assertIdle(`task:${target}`);
      task = this.db.task(target);
    } else {
      const created = this.createTask({ sessionId }, sourceId);
      task = this.db.task(created.id);
    }
    if (task.sourceId !== sourceId)
      throw new Error('此任务属于其他需求版本，请新建任务以保留来源。');
    if (!task.notes.some((note) => note.messageId === messageId)) {
      task.notes.push({
        id: newId(),
        sessionId,
        messageId,
        content: parseChatReply(message.content).content,
        createdAt: now(),
      });
      task.revision++;
      task.plan = null;
      delete task.documentCheckpoint;
      delete task.planCheckpoint;
      task.updatedAt = now();
      this.db.saveTask(task);
    }
    this.db.saveSession({ ...this.db.session(sessionId), taskId: task.id, updatedAt: now() });
    this.notify();
    return this.getTask(task.id);
  }
  updateTask(id, input) {
    this.assertIdle(`task:${id}`);
    const task = this.db.task(id);
    const name = textField(input.name, '任务名称', 160),
      scope = textField(input.scope, '测试范围', 4000);
    const url = input.url ? testUrl(textField(input.url, '测试网址', 2000)) : '';
    if (task.name !== name || task.scope !== scope) {
      task.revision++;
      delete task.documentCheckpoint;
    }
    delete task.planCheckpoint;
    if (task.url !== url) {
      this.retention.forget(id);
      this.retiredBrowsers.delete(id);
      this.browsers.get(id)?.close();
      this.browsers.delete(id);
    }
    Object.assign(task, { name, scope, url, plan: null, updatedAt: now() });
    this.db.saveTask(task);
    this.notify();
    return this.getTask(id);
  }
  generateDocument(id) {
    return this.job(`task:${id}`, 'document', async (signal, progress) => {
      const task = this.db.task(id),
        source = this.db.source(task.sourceId),
        config = await this.settings.modelConfig();
      const data = await generateTestDocument(
        source,
        task,
        config,
        {
          signal,
          fetchImpl: this.fetchImpl,
          checkpoint: task.documentCheckpoint,
          onCheckpoint: (value) => this.saveGeneration(task, 'documentCheckpoint', value),
        },
        progress,
      );
      signal.throwIfAborted();
      const report = {
        ...data,
        id: newId(),
        revision: task.revision,
        createdAt: now(),
        model: config.model,
      };
      report.markdown = renderTestDocument(source, task, report);
      if (task.report) task.reportHistory.push(task.report);
      task.report = report;
      task.plan = null;
      delete task.documentCheckpoint;
      delete task.planCheckpoint;
      task.updatedAt = now();
      this.db.saveTask(task);
      return this.getTask(id);
    });
  }
  openBrowser(id, input = {}) {
    const task = id === 'standalone' ? null : this.db.task(id);
    const projectId = task?.projectId || input.projectId || DEFAULT_PROJECT_ID;
    this.store.projects.get(projectId);
    if (task && input.projectId && input.projectId !== task.projectId)
      throw new Error('测试网页不属于当前工程。');
    const key = task ? id : `page:${newId()}`;
    let browser = this.browsers.get(key);
    if (!browser?.alive()) {
      const url = browserAddress(input.url || task?.url || '');
      if (task && url === 'about:blank') throw new Error('请先填写并保存测试网址。');
      browser = this.makeBrowser(key, url, { projectId });
      browser.browse(url);
    } else if (input.url) {
      this.assertIdle(`task:${key}`);
      browser.browse(browserAddress(input.url));
    }
    browser.visible = true;
    browser.projectId = projectId;
    this.retention.forget(key);
    this.notifyBrowser();
    return key;
  }
  preparePlan(id, caseIds) {
    return this.job(`task:${id}`, 'plan', async (signal, progress) => {
      const task = this.db.task(id),
        browser = this.browsers.get(id);
      if (!task.report || task.report.revision !== task.revision)
        throw new Error('请先生成与当前任务一致的测试文档。');
      if (!browser?.alive()) throw new Error('请先打开测试网站并完成登录。');
      if (
        !Array.isArray(caseIds) ||
        !caseIds.length ||
        caseIds.length > 5 ||
        new Set(caseIds).size !== caseIds.length
      )
        throw new Error('每次请选择 1–5 条用例生成执行计划。');
      const cases = caseIds.map((caseId) => {
        const item = task.report.cases.find((test) => test.id === caseId);
        if (!item) throw new Error('所选用例不存在。');
        return item;
      });
      progress('正在读取当前页面并编写执行计划…');
      const config = await this.settings.modelConfig();
      const plan = await planBrowserTests(browser, cases, config, {
        signal,
        fetchImpl: this.fetchImpl,
        checkpoint: task.planCheckpoint,
        onProgress: progress,
        onCheckpoint: (value) =>
          this.saveGeneration(task, 'planCheckpoint', value, browser.secrets),
      });
      signal.throwIfAborted();
      const safePlan = redactObject(plan, browser.secrets);
      task.plan = {
        ...validatePlan(safePlan, cases, plan.startUrl),
        id: newId(),
        reportId: task.report.id,
        revision: task.revision,
        createdAt: now(),
      };
      delete task.planCheckpoint;
      task.updatedAt = now();
      this.db.saveTask(task);
      return this.getTask(id);
    });
  }
  run(id) {
    return this.job(`task:${id}`, 'run', async (signal, progress) => {
      const task = this.db.task(id);
      let browser = this.browsers.get(id);
      if (!browser?.alive() && this.retiredBrowsers.has(id)) {
        browser = this.makeBrowser(id, task.url, { projectId: task.projectId });
        browser.projectId = task.projectId;
        browser.visible = false;
        this.retention.hide(id);
      }
      if (!browser?.alive()) throw new Error('测试窗口已关闭，请重新打开并生成执行计划。');
      if (
        !task.plan ||
        !task.report ||
        task.plan.reportId !== task.report.id ||
        task.plan.revision !== task.revision
      )
        throw new Error('执行计划已过期，请重新生成。');
      const selected = task.plan.cases.map((item) =>
        task.report.cases.find((test) => test.id === item.caseId),
      );
      const plan = validatePlan(task.plan, selected, task.plan.startUrl);
      if (!plan.cases.some((item) => item.steps.length))
        throw new Error('所选用例均需人工核验，没有可自动执行的步骤。');
      const run = {
        id: newId(),
        taskId: id,
        reportId: task.report.id,
        sourceId: task.sourceId,
        url: task.url,
        status: 'running',
        createdAt: now(),
        finishedAt: null,
        plan,
        cases: [],
        steps: [],
        message: '正在执行',
        untestedCaseIds: task.report.cases
          .filter((item) => !selected.some((test) => test.id === item.id))
          .map((item) => item.id),
      };
      this.db.saveRun(run);
      progress('正在执行已审阅的测试步骤…');
      try {
        browser.beginAutomation(plan.startUrl);
        const result = await executePlan(browser, plan, {
          signal,
          onStep: (caseId, step) => {
            run.steps.push({ caseId, ...step });
            this.db.saveRun(run);
            progress(
              `${caseId} · ${step.description} · ${step.status === 'passed' ? '完成' : '失败'}`,
            );
          },
          onCase: (result) => {
            run.cases.push(result);
            this.db.saveRun(run);
            this.notify();
          },
        });
        signal.throwIfAborted();
        run.cases = result;
        run.status = result.some((item) => item.status === 'failed')
          ? 'failed'
          : result.some((item) => item.status !== 'passed')
            ? 'partial'
            : 'passed';
        run.message =
          run.status === 'passed'
            ? '本次执行计划的断言全部通过；其他用例未执行。'
            : run.status === 'failed'
              ? '执行发现失败，请查看步骤记录。'
              : '部分用例需要人工核验。';
      } catch (error) {
        run.status = signal.aborted ? 'cancelled' : 'failed';
        run.message = signal.aborted
          ? '测试已取消，未完成用例不计为通过。'
          : redact(error.message, browser.secrets);
        throw error;
      } finally {
        browser.endAutomation();
        run.finishedAt = now();
        this.db.saveRun(run);
        this.notify();
      }
      return this.getTask(id);
    });
  }
  exportDocument(id) {
    const task = this.db.task(id),
      source = this.db.source(task.sourceId);
    if (!task.report) throw new Error('请先生成详细测试文档。');
    const labels = {
      passed: '通过',
      failed: '失败',
      partial: '部分完成',
      manual: '需人工核验',
      skipped: '未执行',
      cancelled: '已取消',
      running: '进行中',
    };
    const runs = this.db.runs(id);
    const execution = runs.length
      ? runs
          .map(
            (run) =>
              `### 执行 ${run.createdAt}\n\n- 对应测试文档：${run.reportId}\n- 结果：${labels[run.status]}\n- 测试网站：${run.url}\n- 说明：${run.message}\n- 本次未选择：${run.untestedCaseIds.join('、') || '无'}\n\n${run.cases.map((item) => `- ${item.caseId}：${labels[item.status]}；${item.message}`).join('\n')}\n\n${run.steps.map((step) => `- ${step.caseId} 第${step.index + 1}步 · ${step.description} · ${labels[step.status]}：${step.evidence}`).join('\n')}`,
          )
          .join('\n\n')
      : '暂无执行记录。所有用例均未验证。';
    return {
      name: task.name,
      kind: source.kind,
      source: source.source,
      analysis: {
        kind: 'test-plan',
        content: `${task.report.markdown}\n${task.report.revision !== task.revision ? '\n> 任务结论已更新，以下文档基于旧版本，需重新生成。\n' : ''}\n## 自动化执行记录\n${execution}\n`,
      },
    };
  }
}
