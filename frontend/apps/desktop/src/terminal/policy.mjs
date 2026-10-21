import path from 'node:path';
import os from 'node:os';
import { lstat, readFile, realpath } from 'node:fs/promises';

const programs = new Set([
  'pwd',
  'ls',
  'dir',
  'rg',
  'cat',
  'head',
  'tail',
  'echo',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'node',
  'python',
  'python3',
  'pytest',
  'tsc',
  'vitest',
  'playwright',
]);
const forbidden =
  /(?:^|\s)(?:sudo|su|doas|rm|rmdir|del|erase|format|diskpart|diskutil|mkfs|dd|chmod|chown|reg|regedit|shutdown|reboot|osascript|security|curl|wget|nc|ssh|scp|eval|exec|powershell|pwsh|cmd|bash|sh|zsh|launchctl|schtasks)(?:\s|$)|(?:\.env(?:\.|$|[\s/\\])|\.ssh|\.aws|\.gnupg|keychains?|credential|id_rsa|id_ed25519|Login Data|Cookies|storage-location|test-agent\.sqlite)|(?:--?eval|--?execute|--?encodedcommand|--?executionpolicy|--?require|--?import|--?config(?:=|\s)|-e(?:\s|$)|-c(?:\s|$)|--?exec(?:\s|=)|--pre(?:\s|=)|--ext-diff|--textconv)/i;
export function commandTokens(command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 2000)
    throw new Error('命令需为 1–2000 个字符。');
  if (/[\u0000-\u001f\u007f;&|<>`$%!{}\u200b-\u200f\u202a-\u202e\ufeff]/.test(command))
    throw new Error('只支持单条命令，不支持管道、重定向、变量替换、控制字符或命令串联。');
  const tokens = [];
  let value = '',
    quote = '',
    started = false;
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = '';
      else value += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(value);
        value = '';
        started = false;
      }
    } else {
      value += char;
      started = true;
    }
  }
  if (quote) throw new Error('命令引号没有闭合。');
  if (started) tokens.push(value);
  if (!programs.has(tokens[0]?.toLowerCase()))
    throw new Error('此命令不在工程读取、构建与测试工具范围内。');
  if (forbidden.test(tokens.join(' ')))
    throw new Error('命令涉及危险操作、系统凭据或执行限制绕过，已拦截。');
  if (
    tokens.some((token) =>
      /(?:^|[=\\/])\.\.(?:[\\/]|$)|(?:^|=)(?:~|[a-z]:[\\/]|\\\\|\/)/i.test(token),
    )
  )
    throw new Error('命令参数只能使用工程目录内的相对路径。');
  tokens[0] = tokens[0].toLowerCase();
  const [program, ...args] = tokens;
  if (program === 'git' && !['status', 'diff', 'log', 'show', 'ls-files'].includes(args[0]))
    throw new Error('Git 仅支持查看状态、差异和历史。');
  if (
    ['node', 'python', 'python3'].includes(program) &&
    args.length &&
    !['--version', '-V', '--test'].includes(args[0]) &&
    !/^[\p{L}\p{N}_./\\ -]+\.(?:[cm]?js|py)$/u.test(args[0])
  )
    throw new Error('脚本工具仅支持执行工程内已有脚本，不接受内联代码。');
  if (
    ['npm', 'pnpm', 'yarn'].includes(program) &&
    !['--version', '-v', 'test', 'build', 'lint', 'typecheck', 'check', 'run'].includes(args[0])
  )
    throw new Error('包管理器仅支持已有的构建、检查和测试脚本。');
  if (
    ['npm', 'pnpm', 'yarn'].includes(program) &&
    args[0] === 'run' &&
    !/^(?:test|build|lint|typecheck|check)(?::[\w-]+)?$/.test(args[1] || '')
  )
    throw new Error('仅允许运行测试、构建或检查脚本。');
  if (program === 'playwright' && !['test', '--version'].includes(args[0]))
    throw new Error('Playwright 仅支持运行测试。');
  return tokens;
}
export async function inspectCommand(command, directory) {
  const tokens = commandTokens(command),
    root = await realpath(directory),
    files = [];
  for (const token of tokens.slice(1)) {
    if (token.startsWith('-') || /^(?:https?:)/i.test(token)) continue;
    const candidate = path.resolve(directory, token);
    if (candidate !== directory && !candidate.startsWith(directory + path.sep))
      throw new Error('命令路径超出工程目录。');
    try {
      const actual = await realpath(candidate);
      if (actual !== root && !actual.startsWith(root + path.sep))
        throw new Error('命令不能通过符号链接访问工程外部。');
      const info = await lstat(actual);
      if (info.isFile() && /\.(?:[cm]?js|py|json|toml|ya?ml)$/.test(actual)) {
        if (info.size > 100000) throw new Error('脚本过大，无法审查，暂不执行。');
        files.push({ name: token, content: await readFile(actual, 'utf8') });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const name of ['package.json', 'pyproject.toml']) {
    try {
      const actual = await realpath(path.join(root, name));
      if (!actual.startsWith(root + path.sep)) throw new Error('工程配置不能链接到工程外部。');
      const info = await lstat(actual);
      if (info.size > 100000) throw new Error('工程配置过大，无法审查。');
      files.push({ name, content: await readFile(actual, 'utf8') });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (files.length > 16 || files.reduce((sum, file) => sum + file.content.length, 0) > 64000)
    throw new Error('待审查脚本与配置过多，请拆分命令。');
  if (files.some((file) => forbidden.test(file.content)))
    throw new Error('工程脚本或配置包含受限操作，已拦截。');
  return { tokens, files };
}
export function defaultShell(platform = process.platform, env = process.env) {
  if (platform === 'win32')
    return env.ComSpec || path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  try {
    return os.userInfo().shell || env.SHELL || '/bin/zsh';
  } catch {
    return env.SHELL || '/bin/zsh';
  }
}
export function shellInvocation(shell, tokens, platform = process.platform) {
  if (platform === 'win32')
    return {
      file: shell,
      args: [
        '/d',
        '/s',
        '/c',
        tokens.map((token) => (/\s/.test(token) ? `"${token}"` : token)).join(' '),
      ],
    };
  const command = tokens.map((token) => "'" + token.replaceAll("'", "'\\''") + "'").join(' ');
  const name = path.basename(shell);
  return {
    file: shell,
    args: [
      ...(name === 'zsh'
        ? ['-f']
        : name === 'bash'
          ? ['--noprofile', '--norc']
          : name === 'fish'
            ? ['--no-config']
            : []),
      '-c',
      command,
    ],
  };
}
export function commandEnvironment(env = process.env) {
  const allowed = [
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'PATHEXT',
  ];
  return {
    ...Object.fromEntries(allowed.filter((key) => env[key]).map((key) => [key, env[key]])),
    CI: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
    GIT_PAGER: 'cat',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_cache: '.agent-cache/npm',
    PYTHONPYCACHEPREFIX: '.agent-cache/python',
  };
}
