import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { commandEnvironment, shellInvocation } from './policy.mjs';

export function executeCommand({
  shell,
  tokens,
  cwd,
  onOutput,
  timeoutMs = 120000,
  platform = process.platform,
}) {
  const invocation = shellInvocation(shell, tokens, platform);
  const child = spawn(invocation.file, invocation.args, {
    cwd,
    env: commandEnvironment(),
    windowsHide: true,
    detached: platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cancelled = false,
    timedOut = false,
    timer,
    settled = false;
  const terminate = () => {
    if (!child.pid) return;
    if (platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => child.kill());
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  };
  const done = new Promise((resolve) => {
    const finish = (code, error = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminate();
      resolve({ code, cancelled, timedOut, error });
    };
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8');
      stream.on('data', (data) => onOutput(decoder.write(data)));
      stream.on('end', () => {
        const tail = decoder.end();
        if (tail) onOutput(tail);
      });
    }
    child.on('error', () => finish(null, '无法启动系统 Shell 或执行工具，请检查本机安装和 PATH。'));
    child.on('close', (code) => finish(code));
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref();
  });
  return {
    done,
    stop: () => {
      cancelled = true;
      terminate();
    },
  };
}
