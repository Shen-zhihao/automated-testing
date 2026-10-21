import { createHash } from 'node:crypto';
import { DEFAULT_PROJECT_ID } from '../projects.mjs';

// 旧资料目录归入默认工程；新工程使用独立的 Chromium 会话。
export const BROWSER_PARTITION = 'persist:agent-browser';
export function browserPartition(projectId = DEFAULT_PROJECT_ID) {
  if (projectId === DEFAULT_PROJECT_ID) return BROWSER_PARTITION;
  if (typeof projectId !== 'string' || !projectId) throw new Error('浏览器需要有效工程。');
  return `persist:agent-browser-${createHash('sha256').update(projectId).digest('hex').slice(0, 32)}`;
}

export function browserAddress(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input || input === 'about:blank') return 'about:blank';
  if (input.length > 8192) throw new Error('网址过长。');
  const scheme = /^[a-z][a-z\d+.-]*:/i.test(input);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(input);
  const candidate = /^https?:\/\//i.test(input)
    ? input
    : local
      ? `http://${input}`
      : scheme && !/^[^/:]+:\d+(?:\/|$)/.test(input)
        ? input
        : `https://${input}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new Error('请输入有效的 HTTP 或 HTTPS 网址，不要在网址中填写账号密码。');
  }
}

export function browserNavigationAllowed(value) {
  if (value === 'about:blank') return true;
  try {
    const url = new URL(value);
    if (url.protocol === 'blob:')
      return browserNavigationAllowed(url.pathname) && url.origin !== 'null';
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
