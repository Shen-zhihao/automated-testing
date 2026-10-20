import { BrowserWindow, dialog, ipcMain } from 'electron';
import { isAppNavigation } from './resources.mjs';
import { FILE_EXTENSIONS } from './documents/parse.mjs';

export function registerWorkspaceHandlers(workspace, development) {
  const handlers = {
    snapshot: () => workspace.snapshot(),
    document: (_, id) => workspace.store.getDocument(id),
    'import-files': async (event) => {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: '导入文档',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '常用文档', extensions: FILE_EXTENSIONS }],
      });
      return result.canceled
        ? { imported: [], errors: [] }
        : workspace.importFiles(result.filePaths);
    },
    'import-feishu': (_, url) => workspace.importFeishu(url),
    'delete-document': (_, id) => workspace.remove(id),
    analyze: (_, id, goal) => workspace.analyze(id, goal),
    cancel: (_, id) => workspace.cancel(id),
    'save-settings': async (_, input) => {
      const value = await workspace.settings.save(input);
      workspace.notify();
      return value;
    },
    'test-model': () => workspace.testModel(),
    'test-feishu': (_, input) => workspace.feishu.testConnection(input),
  };
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`workspace:${name}`, async (event, ...args) => {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        !isAppNavigation(event.senderFrame.url, development)
      )
        return { ok: false, error: '此页面无权调用本机功能。' };
      try {
        return { ok: true, value: await handler(event, ...args) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '操作失败，请重试。' };
      }
    });
  }
}
