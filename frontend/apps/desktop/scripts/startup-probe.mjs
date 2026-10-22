import { app } from 'electron';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import os from 'node:os';

const profile = process.argv[2];
if (
  !profile ||
  path.dirname(profile) !== os.tmpdir() ||
  !path.basename(profile).startsWith('xuzhou-startup-')
)
  throw new Error('启动探针只能使用专用临时资料目录。');
app.setPath('appData', profile);
const started = performance.now();
async function waitFor(window, expression, accept) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = await window.webContents.executeJavaScript(expression);
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('隔离 UI 检查超时。');
}
app.on('browser-window-created', (_, window) => {
  window.show = () => {}; // 不打断用户正在使用的窗口。
  window.webContents.once('did-finish-load', async () => {
    try {
      const windowLoadedMs = performance.now() - started;
      let chat;
      if (process.argv[3] === 'chat') {
        const opened = performance.now();
        await window.webContents.executeJavaScript(
          `location.hash = '#/projects/local-default/chat?session=benchmark-chat'`,
        );
        for (let attempt = 0; attempt < 100; attempt++) {
          chat = await window.webContents.executeJavaScript(`({
          count: document.querySelectorAll('.messageItem').length,
          title: document.querySelector('.chatTitle')?.textContent,
          olderButton: Boolean(document.querySelector('.messageHistoryButton'))
        })`);
          if (chat.count && chat.title === '性能测试对话') break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!chat?.count) {
          console.error('Chat did not load');
          app.exit(1);
          return;
        }
        chat.openedMs = performance.now() - opened;
      }
      app.getAppMetrics();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const renderer = await window.webContents.executeJavaScript(`({
      uiReady: Boolean(document.querySelector('.projectsPage, .chatHomePage')),
      visibleText: document.body.innerText.slice(0, 200),
      domReadyMs: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
      resources: performance.getEntriesByType('resource').length,
      heapBytes: performance.memory?.usedJSHeapSize ?? null
    })`);
      if (!renderer.uiReady) {
        console.error(JSON.stringify(renderer));
        app.exit(1);
        return;
      }
      delete renderer.visibleText;
      const processes = app.getAppMetrics().map((item) => ({
        type: item.type,
        workingSetKB: item.memory.workingSetSize,
        privateKB: item.memory.privateBytes,
        cpuPercent: item.cpu.percentCPUUsage,
      }));
      let checks;
      if (process.argv[4] === '0') {
        if (chat?.olderButton) {
          await window.webContents.executeJavaScript(
            `document.querySelector('.messageHistoryButton').click()`,
          );
          checks = await waitFor(
            window,
            `({ count: document.querySelectorAll('.messageItem').length,
          firstUser: document.querySelector('.userMessageText')?.textContent })`,
            (value) => value.count === 80,
          );
          if (checks.firstUser !== '核验场景 320') throw new Error('展开历史后消息次序不正确。');
        }
        await window.webContents.executeJavaScript(
          `document.querySelector('.sidebarCreate').click()`,
        );
        await waitFor(window, `Boolean(document.querySelector('[role="dialog"] input'))`, Boolean);
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent.trim() === '取消').click()`,
        );
        if (chat) {
          await window.webContents.executeJavaScript(
            `document.querySelector('[aria-label="打开内置浏览器"]').click()`,
          );
          await waitFor(window, `Boolean(document.querySelector('.browserAddress'))`, Boolean);
        }
        checks = { ...checks, projectDialogOpened: true, browserOpened: Boolean(chat) };
      }
      console.log(
        'STARTUP_PROBE:' +
          JSON.stringify({
            windowLoadedMs,
            ...(chat ? { chat } : {}),
            ...(checks ? { checks } : {}),
            renderer,
            processes,
            workingSetKB: processes.reduce((sum, item) => sum + item.workingSetKB, 0),
          }),
      );
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
await import('../src/main.mjs');
