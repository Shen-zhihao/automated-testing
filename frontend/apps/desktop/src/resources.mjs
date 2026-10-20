import path from 'node:path';

export const APP_URL = 'test-agent://app/index.html';
export const DEV_URL = 'http://127.0.0.1:5180/';

/** 将自定义协议严格限定在 UI 构建目录内，同时拒绝 Windows 路径分隔符。 */
export function resolveUiResource(root, requestUrl, pathApi = path) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'test-agent:' || url.host !== 'app' || url.username || url.password)
      return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const relativeName = pathname === '/' ? '/index.html' : pathname;
    const resolved = pathApi.resolve(root, `.${relativeName}`);
    const relative = pathApi.relative(root, resolved);
    if (!relative || relative.startsWith('..') || pathApi.isAbsolute(relative)) return null;
    return resolved;
  } catch {
    return null;
  }
}

export function isAppNavigation(url, development) {
  try {
    const target = new URL(url);
    target.hash = '';
    return target.href === (development ? DEV_URL : APP_URL);
  } catch {
    return false;
  }
}
