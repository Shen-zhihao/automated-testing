import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  net,
  protocol,
  session,
  safeStorage,
  nativeTheme,
} from 'electron';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_URL, DEV_URL, isAppNavigation, resolveUiResource } from './resources.mjs';
import {
  AppearanceService,
  windowBackground,
  windowChrome,
  applyWindowAppearance,
} from './appearance.mjs';
import { StorageService } from './storage.mjs';
import { SettingsService } from './settings.mjs';
import { WorkspaceService } from './workspace.mjs';
import { FeishuService } from './feishu.mjs';
import { parseInWorker } from './documents/import.mjs';
import { registerWorkspaceHandlers } from './ipc.mjs';
import { APP_DISPLAY_NAME, applicationMenuTemplate } from './menu.mjs';
import { TestingService } from './testing/service.mjs';
import { TerminalService } from './terminal/service.mjs';
import { TestBrowser } from './testing/browser.mjs';
import { projectBrowserStorage, purgeDeletedProfiles } from './testing/browser-storage.mjs';

const development = !app.isPackaged && process.argv.includes('--dev');
const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const appIcon = path.resolve(sourceRoot, '../assets/brand/icon-runtime.png');
const uiRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'ui')
  : path.resolve(sourceRoot, '../../agent-web/dist');

// 旧名称也是 safeStorage 的系统凭据身份；品牌更名只更新展示名称和图标。
app.setName('Test Agent');
app.setPath(
  'userData',
  path.join(app.getPath('appData'), development ? 'Test Agent Development' : 'Test Agent'),
);
app.setPath('sessionData', app.getPath('userData'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'test-agent', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const fail = (error) => {
  console.error(error);
  dialog.showErrorBox(
    `${APP_DISPLAY_NAME}启动失败`,
    error instanceof Error ? error.message : String(error),
  );
  app.exit(1);
};

let appearance;

async function createWindow() {
  const window = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    icon: appIcon,
    width: 1280,
    height: 840,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: windowBackground(appearance.public().theme),
    ...windowChrome(appearance.public().theme),
    show: false,
    webPreferences: {
      preload: path.join(sourceRoot, 'preload.cjs'),
      additionalArguments: [
        `--test-agent-appearance=${appearance.public().mode}:${appearance.public().theme}`,
      ],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guardNavigation = (event, url) => {
    if (!isAppNavigation(url, development)) event.preventDefault();
  };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);
  window.once('ready-to-show', () => window.show());
  await window.loadURL(development ? DEV_URL : APP_URL);
  return window;
}

if (!['darwin', 'win32'].includes(process.platform)) {
  app.whenReady().then(() => fail(new Error('当前桌面原型仅支持 Windows 和 macOS。')));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else if (app.isReady()) {
      void createWindow().catch(fail);
    }
  });
  app
    .whenReady()
    .then(async () => {
      let quitting = false;
      const pendingNotifications = new Map();
      const broadcast = (channel) => {
        if (quitting || pendingNotifications.has(channel)) return;
        pendingNotifications.set(
          channel,
          setTimeout(() => {
            pendingNotifications.delete(channel);
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.webContents.isDestroyed()) window.webContents.send(channel);
            }
          }, 32),
        );
      };
      const notify = () => broadcast('workspace:changed');
      const notifyBrowser = () => broadcast('workspace:browser-changed');
      const storage = new StorageService(app.getPath('userData'), {
        notify,
        forbiddenRoots: app.isPackaged
          ? [process.resourcesPath]
          : [path.resolve(sourceRoot, '../../../..')],
      });
      const store = storage.store;
      let workspace;
      appearance = new AppearanceService(store, nativeTheme, {
        onChanged: ({ theme }) => {
          for (const window of BrowserWindow.getAllWindows()) applyWindowAppearance(window, theme);
          for (const browser of workspace?.testing?.browsers.values() || [])
            browser.updateAppearance?.();
          broadcast('workspace:appearance-changed');
        },
      });
      const settings = new SettingsService(store, {
        encrypt: async (value) => {
          if (!(await safeStorage.isAsyncEncryptionAvailable()))
            throw new Error('系统安全存储暂不可用，凭据未保存。请解锁系统凭据存储后重试。');
          return safeStorage.encryptStringAsync(value);
        },
        decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
      });
      const feishu = new FeishuService(settings, { notify });
      const downloads = new Set();
      let profileCleanup;
      const testing = new TestingService({
        store,
        settings,
        notify,
        browserFactory: (url, options) =>
          new TestBrowser(url, {
            ...options,
            onDownload: (item, projectId, browser) => {
              const work = () =>
                workspace.runProject(projectId, async () => {
                  const download = await new Promise((resolve) =>
                    item.once('done', (_, state) => resolve({ state, file: item.getSavePath() })),
                  );
                  if (download.file) {
                    try {
                      await access(download.file);
                      await workspace.projectFiles.record(projectId, download.file);
                    } catch (error) {
                      if (error.code !== 'ENOENT') throw error;
                    }
                  }
                });
              const pending = storage
                .run(work)
                .catch(() => {
                  item.cancel();
                  browser.error = '下载记录保存失败，请在保存位置检查文件。';
                  browser.onChanged();
                })
                .finally(() => downloads.delete(pending));
              downloads.add(pending);
            },
          }),
        notifyBrowser,
      });
      workspace = new WorkspaceService({
        store,
        settings,
        feishu,
        parseFile: parseInWorker,
        notify,
        storage,
        testing,
        projectBrowser: projectBrowserStorage,
      });
      workspace.appearance = appearance;
      workspace.terminal = new TerminalService(workspace, {
        root: path.join(app.getPath('userData'), 'projects'),
      });
      testing.terminal = workspace.terminal;
      registerWorkspaceHandlers(workspace, development);
      app.on('before-quit', (event) => {
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        for (const timer of pendingNotifications.values()) clearTimeout(timer);
        pendingNotifications.clear();
        appearance.close();
        workspace.cancelAll();
        void Promise.allSettled([
          feishu.close(),
          storage.pending,
          workspace.terminal.close(),
          profileCleanup,
          ...downloads,
        ]).finally(() => app.quit());
      });
      process.on('SIGINT', () => app.quit());
      process.on('SIGTERM', () => app.quit());
      if (!development) {
        await access(path.join(uiRoot, 'index.html')).catch(() => {
          throw new Error('找不到本地 UI 构建产物，请先在 frontend 目录运行 pnpm build:agent。');
        });
        protocol.handle('test-agent', async (request) => {
          const resource = resolveUiResource(uiRoot, request.url);
          if (!resource || request.method !== 'GET')
            return new Response('Not found', { status: 404 });
          try {
            return await net.fetch(pathToFileURL(resource).toString());
          } catch {
            return new Response('Not found', { status: 404 });
          }
        });
      }
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
        callback(
          permission === 'clipboard-sanitized-write' &&
            isAppNavigation(contents.getURL(), development),
        );
      });
      app.dock?.setIcon(appIcon);
      app.setAboutPanelOptions({ applicationName: APP_DISPLAY_NAME, iconPath: appIcon });
      Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()));
      await createWindow();
      // Deleted profiles cannot belong to an active project. Their disk cleanup is
      // outside the first-window path, but still excludes concurrent data migration.
      if (!quitting)
        profileCleanup = storage
          .run(() => purgeDeletedProfiles(store, app.getPath('sessionData')))
          .catch(() => {});
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(fail);
      });
    })
    .catch(fail);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
