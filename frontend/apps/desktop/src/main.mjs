import { app, BrowserWindow, dialog, Menu, net, protocol, session } from 'electron';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_URL, DEV_URL, isAppNavigation, resolveUiResource } from './resources.mjs';

const development = !app.isPackaged && process.argv.includes('--dev');
const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'ui')
  : path.resolve(sourceRoot, '../../agent-web/dist');

app.setName('Test Agent');
app.setPath(
  'userData',
  path.join(app.getPath('appData'), development ? 'Test Agent Development' : 'Test Agent'),
);
protocol.registerSchemesAsPrivileged([
  { scheme: 'test-agent', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const fail = (error) => {
  console.error(error);
  dialog.showErrorBox(
    'Test Agent 启动失败',
    error instanceof Error ? error.message : String(error),
  );
  app.exit(1);
};

async function createWindow() {
  const window = new BrowserWindow({
    title: 'Test Agent',
    width: 1280,
    height: 840,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: '#f3f4f6',
    show: false,
    webPreferences: {
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
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
          { role: 'fileMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ]),
      );
      await createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(fail);
      });
    })
    .catch(fail);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
