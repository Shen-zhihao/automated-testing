import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

if (!['darwin', 'win32'].includes(process.platform)) {
  throw new Error('桌面原型仅支持 Windows 和 macOS。');
}
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const uiRoot = path.resolve(appRoot, '../agent-web');
const development = process.argv.includes('--dev');
let server;
let child;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) child.kill();
  await server?.close();
  process.exitCode = code;
}

try {
  if (development) {
    const { createServer } = await import('vite');
    server = await createServer({
      root: uiRoot,
      configFile: path.join(uiRoot, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: 5180, strictPort: true },
    });
    await server.listen();
    server.printUrls();
  }
  // 外层工具可能使用 ELECTRON_RUN_AS_NODE；桌面进程必须以应用模式运行。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [appRoot, ...(development ? ['--dev'] : [])], { stdio: 'inherit', env });
  child.on('error', (error) => {
    console.error(error);
    void stop(1);
  });
  child.on('exit', (code) => {
    void stop(code ?? 1);
  });
  process.on('SIGINT', () => {
    void stop();
  });
  process.on('SIGTERM', () => {
    void stop();
  });
} catch (error) {
  console.error(error);
  await stop(1);
}
