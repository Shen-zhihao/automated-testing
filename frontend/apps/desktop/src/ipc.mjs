import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { isAppNavigation } from './resources.mjs';
import { FILE_EXTENSIONS } from './documents/content.mjs';
import { saveMarkdownReport } from './reports.mjs';
import { assertProjectOperation, projectActions } from './projects.mjs';

export function registerWorkspaceHandlers(workspace, development) {
  const selections = new Map();
  const handlers = {
    'appearance-get': () => workspace.appearance.public(),
    'appearance-set': (_, mode) => workspace.appearance.set(mode),
    'command-info': (_, id) => workspace.terminal.info(id),
    'command-get': (_, id, runId) => workspace.terminal.publicRun(id, runId),
    'command-list': (_, id) => workspace.terminal.list(id),
    'command-mode': (_, id, mode) => workspace.terminal.setMode(id, mode),
    'command-propose': (_, id, input) => workspace.terminal.propose(id, input),
    'command-start': (_, id, runId) => workspace.terminal.start(id, runId, true),
    'command-reject': (_, id, runId) => workspace.terminal.reject(id, runId),
    'command-stop': (_, id) => workspace.terminal.stop(id),
    'command-directory': async (_, id) => {
      const error = await shell.openPath(await workspace.terminal.ensureDirectory(id));
      if (error) throw new Error('无法打开工程工作目录。');
    },
    snapshot: (_, projectId) => workspace.snapshot(projectId),
    'project-files': (_, id) => workspace.projectFiles.list(id),
    'project-clean': (_, id, input) => workspace.projectFiles.clean(id, input),
    'project-cache': (_, id) => workspace.projectFiles.clearCache(id),
    'project-delete': (_, id, name) => workspace.projectFiles.remove(id, name),
    'project-create': (_, input) => {
      const value = workspace.store.projects.create(input);
      workspace.notify();
      return value;
    },
    'project-update': (_, id, input) => {
      const value = workspace.store.projects.update(id, input);
      workspace.notify();
      return value;
    },
    'chat-rename': (_, projectId, id, title) => workspace.testing.renameSession(id, title),
    'testing-features': (_, projectId, id) => workspace.testing.features(id),
    'chat-create': (_, projectId, input) =>
      workspace.testing.createSession({ ...input, projectId }),
    'chat-get': (_, projectId, id) => workspace.testing.getSession(id),
    'chat-send': (_, projectId, id, content) => workspace.testing.sendMessage(id, content),
    'chat-keep': (_, projectId, id, messageId, taskId) =>
      workspace.testing.keepMessage(id, messageId, taskId),
    'testing-create': (_, projectId, input) =>
      workspace.testing.createTask({ ...input, projectId }),
    'testing-get': (_, projectId, id) => workspace.testing.getTask(id),
    'testing-update': (_, projectId, id, input) => workspace.testing.updateTask(id, input),
    'testing-document': (_, projectId, id) => workspace.testing.generateDocument(id),
    'testing-cancel': (_, projectId, key) => workspace.testing.cancel(key),
    'testing-browser': (_, id, input) => workspace.testing.openBrowser(id, input),
    'testing-plan': (_, projectId, id, caseIds) => workspace.testing.preparePlan(id, caseIds),
    'testing-run': (_, projectId, id) => workspace.testing.run(id),
    'browser-info': (_, id) => workspace.testing.browserInfo(id),
    'browser-attach': (event, id, bounds) =>
      workspace.testing.attachBrowser(id, BrowserWindow.fromWebContents(event.sender), bounds),
    'browser-navigate': (_, id, action) => workspace.testing.navigateBrowser(id, action),
    'browser-tabs': () => workspace.testing.browserTabs(),
    'browser-hide': (_, id) => workspace.testing.hideBrowser(id),
    'browser-load': (_, id, url) => workspace.testing.loadBrowser(id, url),
    'browser-data': () => workspace.testing.browserData.list(),
    'browser-import': async (event, kind) => {
      if (!['bookmarks', 'passwords'].includes(kind)) throw new Error('导入类型无效。');
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: kind === 'bookmarks' ? '导入浏览器书签' : '导入浏览器密码',
        buttonLabel: '导入',
        properties: ['openFile'],
        filters: [
          {
            name: kind === 'bookmarks' ? '浏览器书签 HTML' : '浏览器密码 CSV',
            extensions: kind === 'bookmarks' ? ['html', 'htm'] : ['csv'],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return workspace.testing.browserData.importFile(kind, result.filePaths[0]);
    },
    'browser-data-remove': (_, kind, id) => workspace.testing.browserData.remove(kind, id),
    'browser-password-fill': (_, id, passwordId) =>
      workspace.testing.fillBrowserPassword(id, passwordId),
    'testing-export': async (event, projectId, id) =>
      workspace.projectFiles.record(
        projectId,
        await saveMarkdownReport(workspace.testing.exportDocument(id), (filename) =>
          dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
            title: '保存详细测试文档',
            defaultPath: path.join(app.getPath('documents'), filename),
            filters: [{ name: 'Markdown 文档', extensions: ['md'] }],
            properties: ['createDirectory', 'showOverwriteConfirmation'],
          }),
        ),
      ),
    document: (_, projectId, id) => workspace.store.getDocument(id),
    'import-files': async (event, projectId) => {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: '导入文档',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '常用文档', extensions: FILE_EXTENSIONS }],
      });
      return result.canceled
        ? { imported: [], errors: [] }
        : workspace.importFiles(result.filePaths, projectId);
    },
    'import-feishu': (_, projectId, url) => workspace.importFeishu(url, projectId),
    'refresh-document': (_, projectId, id) => workspace.refreshDocument(id),
    'delete-document': (_, projectId, id) =>
      workspace.projectFiles.clean(projectId, { documentIds: [id] }),
    analyze: (_, projectId, id, goal) => workspace.analyze(id, goal),
    'export-analysis': async (event, projectId, id) =>
      workspace.projectFiles.record(
        projectId,
        await saveMarkdownReport(workspace.store.getDocument(id), (filename) =>
          dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
            title: '保存 Markdown 文档',
            defaultPath: path.join(app.getPath('documents'), filename),
            buttonLabel: '保存',
            filters: [{ name: 'Markdown 文档', extensions: ['md'] }],
            properties: ['createDirectory', 'showOverwriteConfirmation'],
          }),
        ),
      ),
    cancel: (_, projectId, id) => workspace.cancel(id),
    'save-settings': async (_, input) => {
      const value = await workspace.settings.save(input);
      workspace.notify();
      return value;
    },
    'test-model': () => workspace.testModel(),
    'test-feishu': (_, input) => workspace.feishu.testConnection(input),
    'select-storage': async (event) => {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: '选择本地数据保存目录',
        buttonLabel: '选择此文件夹',
        defaultPath: workspace.storage.info().directory,
        properties: ['openDirectory', 'createDirectory'],
      });
      const directory = result.canceled ? null : result.filePaths[0];
      selections.set(event.sender.id, directory);
      return directory;
    },
    'relocate-storage': async (event, directory) => {
      if (!directory || selections.get(event.sender.id) !== directory)
        throw new Error('请先通过文件夹选择器选择保存位置。');
      const result = await workspace.storage.relocate(directory);
      selections.delete(event.sender.id);
      return result;
    },
    'open-storage': async () => {
      const error = await shell.openPath(workspace.storage.info().directory);
      if (error) throw new Error('无法打开保存目录，请检查目录是否可用。');
    },
  };
  const reads = new Set([
    'snapshot',
    'appearance-get',
    'document',
    'cancel',
    'select-storage',
    'relocate-storage',
    'open-storage',
    'testing-cancel',
    'browser-info',
    'browser-attach',
    'chat-get',
    'testing-get',
    'testing-features',
    'browser-tabs',
    'browser-hide',
  ]);
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`workspace:${name}`, async (event, ...args) => {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        !isAppNavigation(event.senderFrame.url, development)
      )
        return { ok: false, error: '此页面无权调用本机功能。' };
      try {
        if (projectActions.has(name))
          assertProjectOperation(workspace.store, name, args[0], args.slice(1));
        let projectId = projectActions.has(name) && name !== 'delete-document' ? args[0] : null;
        if (
          ['project-update', 'project-files', 'command-propose', 'command-directory'].includes(name)
        )
          projectId = args[0];
        if (name.startsWith('command-')) workspace.store.projects.get(args[0]);
        if (name === 'testing-browser')
          projectId =
            args[0] !== 'standalone'
              ? workspace.testing.db.task(args[0]).projectId
              : args[1]?.projectId;
        if (name === 'testing-browser' && !projectId)
          throw new Error('请先打开工程，再使用内置浏览器。');
        if (['browser-password-fill', 'browser-load', 'browser-navigate'].includes(name))
          projectId = workspace.testing.browsers.get(args[0])?.projectId;
        const operation = () =>
          projectId
            ? workspace.runProject(projectId, () => handler(event, ...args))
            : handler(event, ...args);
        return {
          ok: true,
          value: await (reads.has(name) ? operation() : workspace.storage.run(operation)),
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '操作失败，请重试。' };
      }
    });
  }
}
