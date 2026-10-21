import { WebContentsView, session, dialog, nativeTheme } from 'electron';
import { browserPartition, browserAddress, browserNavigationAllowed } from './browser-policy.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { testUrl, redact, redactObject } from './automation.mjs';
import { windowBackground } from '../appearance.mjs';
import { fillLoginForm } from '../browser-data/fill.mjs';

// 固定的 DOM 操作器；模型只能提供受限数据，不能提供可执行代码。
function domOperation(operation, input) {
  const visible = (element) =>
    Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden';
  const name = (element) =>
    (
      element.getAttribute('aria-label') ||
      element.labels?.[0]?.innerText ||
      element.innerText ||
      element.getAttribute('placeholder') ||
      ''
    ).trim();
  const locate = (locator) => {
    let elements;
    if (locator.by === 'css') elements = [...document.querySelectorAll(locator.value)];
    else if (locator.by === 'placeholder')
      elements = [...document.querySelectorAll('input,textarea')].filter(
        (element) => element.getAttribute('placeholder') === locator.value,
      );
    else if (locator.by === 'label')
      elements = [
        ...document.querySelectorAll('input,textarea,select,button,[role="button"]'),
      ].filter((element) => name(element) === locator.value);
    else
      elements = [...document.querySelectorAll('body *')].filter(
        (element) =>
          element.innerText?.trim() === locator.value &&
          ![...element.children].some((child) => child.innerText?.trim() === locator.value),
      );
    elements = elements.filter(visible);
    if (elements.length !== 1)
      throw new Error(
        elements.length ? '定位到多个元素，请细化执行计划。' : '未找到预期页面元素。',
      );
    return elements[0];
  };
  const setValue = (element, value) => {
    if (element.disabled || element.readOnly) throw new Error('输入控件不可编辑。');
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (operation === 'snapshot') {
    const clone = document.body.cloneNode(true);
    clone
      .querySelectorAll('script,style,noscript,input,textarea')
      .forEach((element) => element.remove());
    return {
      url: location.href,
      title: document.title,
      text: (clone.textContent || '').replace(/\s+/g, ' ').slice(0, 14000),
      controls: [
        ...document.querySelectorAll('button,a[href],input,textarea,select,[role="button"]'),
      ]
        .filter(visible)
        .slice(0, 120)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          type: element.type || '',
          name: name(element).slice(0, 160),
          placeholder: element.getAttribute('placeholder') || '',
          id: element.id || '',
          testId: element.getAttribute('data-testid') || '',
          disabled: Boolean(element.disabled),
        })),
    };
  }
  if (input.action === 'assertText') {
    if (!document.body.innerText.includes(input.value))
      throw new Error(`页面未出现预期文字：${input.value}`);
    return `可见文字包含：${input.value}`;
  }
  if (input.action === 'assertUrl') {
    if (!location.href.includes(input.value)) throw new Error('当前网址不符合预期。');
    return '当前网址符合预期。';
  }
  const element = locate(input.locator);
  if (input.action === 'assertVisible') return `目标元素可见：${input.locator.value}`;
  if (element.disabled) throw new Error('目标控件不可操作。');
  if (input.action === 'fill' || input.action === 'select') {
    if (element.type === 'password')
      throw new Error('密码只在登录时填写，测试步骤不能操作密码输入框。');
    if (
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
      ['file', 'hidden'].includes(element.type)
    )
      throw new Error('不支持在该控件填入内容。');
    if (
      input.action === 'select' &&
      ![...(element.options || [])].some((option) => option.value === input.value)
    )
      throw new Error('下拉选项不存在。');
    setValue(element, input.value);
    return '已填写指定控件。';
  }
  const label = name(element);
  if (
    /删除|注销|支付|购买|转账|授权|永久|delete|remove|pay\b|purchase|buy\b|transfer|authorize/i.test(
      label,
    )
  )
    throw new Error('该操作需要人工完成，自动执行已停止。');
  const link = element.closest('a[href]');
  if (link && new URL(link.href, location.href).origin !== location.origin)
    throw new Error('该入口将离开当前站点，自动执行已停止。');
  const form = element.closest('form');
  if (form?.action && new URL(form.action, location.href).origin !== location.origin)
    throw new Error('表单将提交到其他站点，自动执行已停止。');
  if (input.action === 'check') {
    if (!['checkbox', 'radio'].includes(element.type)) throw new Error('目标不是复选框或单选框。');
    if (!element.checked) element.click();
  } else element.click();
  return '已操作指定控件。';
}

const configuredSessions = new WeakSet();
const browserOwners = new WeakMap();
const permissionNames = {
  media: '摄像头或麦克风',
  geolocation: '位置信息',
  notifications: '通知',
  'clipboard-read': '剪贴板',
  fullscreen: '全屏显示',
};
function configureSession(profile) {
  if (configuredSessions.has(profile)) return;
  configuredSessions.add(profile);
  const grants = new Set();
  profile.setPermissionCheckHandler(
    (_contents, permission, origin) =>
      permission === 'clipboard-sanitized-write' || grants.has(`${origin}|${permission}`),
  );
  profile.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    const browser = browserOwners.get(contents);
    if (permission === 'clipboard-sanitized-write') return callback(true);
    if (!browser || browser.automationOrigin || !permissionNames[permission])
      return callback(false);
    let origin;
    try {
      origin = new URL(details.requestingUrl || contents.getURL()).origin;
    } catch {
      return callback(false);
    }
    const key = `${origin}|${permission}`;
    if (grants.has(key)) return callback(true);
    try {
      const options = {
        type: 'question',
        title: '网站权限',
        message: `${origin} 请求使用${permissionNames[permission]}`,
        buttons: ['不允许', '允许'],
        defaultId: 0,
        cancelId: 0,
      };
      const result =
        browser.parent && !browser.parent.isDestroyed()
          ? await dialog.showMessageBox(browser.parent, options)
          : await dialog.showMessageBox(options);
      if (result.response === 1) grants.add(key);
      callback(result.response === 1);
    } catch {
      callback(false);
    }
  });
  profile.on('will-download', (event, item, contents) => {
    const browser = browserOwners.get(contents);
    if (!browser) {
      event.preventDefault();
      return;
    }
    if (browser.automationOrigin) {
      event.preventDefault();
      browser.automationError = '此步骤触发了下载，请改为人工验证。';
      return;
    }
    browser.downloads.add(item);
    item.once('done', () => {
      browser.downloads.delete(item);
      browser.onChanged();
    });
    browser.onDownload?.(item, browser.projectId, browser);
  });
}

export class TestBrowser {
  constructor(
    url = 'about:blank',
    { onPopup, onChanged = () => {}, webPreferences = {}, webContents, projectId, onDownload } = {},
  ) {
    this.url = browserAddress(url);
    this.secrets = [];
    this.visible = true;
    this.error = '';
    this.automationOrigin = null;
    this.automationError = '';
    this.onChanged = onChanged;
    this.onDownload = onDownload;
    this.downloads = new Set();
    this.projectId = projectId;
    this.partition = browserPartition(projectId);
    const profile = session.fromPartition(this.partition);
    configureSession(profile);
    this.view = new WebContentsView({
      ...(webContents ? { webContents } : {}),
      webPreferences: {
        ...webPreferences,
        session: profile,
        partition: this.partition,
        preload: undefined,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
    });
    this.updateAppearance = () =>
      this.view.setBackgroundColor(
        windowBackground(nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
      );
    this.updateAppearance();
    this.contents = this.view.webContents;
    browserOwners.set(this.contents, this);
    this.contents.setWindowOpenHandler(({ url: target }) => {
      if (this.automationOrigin) {
        this.automationError = '此步骤打开了新网页，请改为人工验证。';
        return { action: 'deny' };
      }
      if (!onPopup || !browserNavigationAllowed(target)) return { action: 'deny' };
      try {
        browserAddress(target);
      } catch {
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            session: profile,
            partition: this.partition,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
            preload: undefined,
          },
        },
        createWindow: (options) => onPopup(target, options).contents,
      };
    });
    const guard = (event, target) => {
      const allowed =
        browserNavigationAllowed(target) &&
        (!this.automationOrigin || new URL(target).origin === this.automationOrigin);
      if (!allowed) {
        event.preventDefault();
        this.error = this.automationOrigin
          ? '测试步骤离开了当前站点，已停止。'
          : '此链接无法在内置浏览器中打开。';
        if (this.automationOrigin) this.automationError = this.error;
        this.onChanged();
      }
    };
    this.contents.on('will-navigate', guard);
    this.contents.on('will-redirect', guard);
    this.contents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) guard(details, details.url);
    });
    this.contents.on('will-attach-webview', (event) => event.preventDefault());
    this.contents.on('did-start-loading', () => {
      this.error = '';
      this.onChanged();
    });
    this.contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.error = `页面加载失败：${description}`;
      this.onChanged();
    });
    for (const event of [
      'did-stop-loading',
      'did-navigate',
      'did-navigate-in-page',
      'page-title-updated',
    ])
      this.contents.on(event, () => this.onChanged());
    this.contents.on('render-process-gone', () => {
      this.error = '网页进程已退出，请刷新重试。';
      this.onChanged();
    });
    this.contents.on('destroyed', () => {
      this.visible = false;
      this.onChanged();
    });
  }
  alive() {
    return !this.contents.isDestroyed();
  }
  attach(parent, bounds) {
    this.check();
    if (!bounds) {
      if (this.parent && !this.parent.isDestroyed())
        this.parent.contentView.removeChildView(this.view);
      this.parent = null;
      this.lastBounds = null;
      this.view.setVisible(false);
      return;
    }
    const [width, height] = parent.getContentSize();
    if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key])))
      throw new Error('浏览器显示区域无效。');
    const x = Math.max(0, Math.min(width, Math.round(bounds.x))),
      y = Math.max(0, Math.min(height, Math.round(bounds.y)));
    const next = {
      x,
      y,
      width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
      height: Math.max(1, Math.min(height - y, Math.round(bounds.height))),
    };
    if (this.parent !== parent) {
      if (this.parent && !this.parent.isDestroyed())
        this.parent.contentView.removeChildView(this.view);
      parent.contentView.addChildView(this.view);
      this.lastBounds = null;
    }
    if (!this.lastBounds || Object.keys(next).some((key) => next[key] !== this.lastBounds[key]))
      this.view.setBounds(next);
    this.lastBounds = next;
    this.view.setVisible(true);
    this.parent = parent;
  }
  info() {
    return {
      title: this.alive() ? this.contents.getTitle() || '新标签页' : '网页已关闭',
      loading: this.alive() && this.contents.isLoading(),
      error: this.error,
      open: this.alive(),
      url: this.alive() ? this.contents.getURL() : this.url,
      canGoBack: this.alive() && this.contents.navigationHistory.canGoBack(),
      canGoForward: this.alive() && this.contents.navigationHistory.canGoForward(),
    };
  }
  browse(value) {
    this.check();
    if (this.automationOrigin) throw new Error('任务执行中，暂不能更改测试页面。');
    this.url = browserAddress(value);
    this.error = '';
    void this.contents.loadURL(this.url).catch((error) => {
      if (error.code !== 'ERR_ABORTED') this.error = `页面加载失败：${error.message}`;
      this.onChanged();
    });
  }
  beginAutomation(url) {
    this.check();
    this.automationOrigin = new URL(testUrl(url)).origin;
    this.automationError = '';
    this.contents.setBackgroundThrottling(false);
  }
  endAutomation() {
    this.automationOrigin = null;
    this.automationError = '';
    if (this.alive()) this.contents.setBackgroundThrottling(true);
  }
  navigate(action) {
    this.check();
    if (action === 'back' && this.contents.navigationHistory.canGoBack())
      this.contents.navigationHistory.goBack();
    else if (action === 'forward' && this.contents.navigationHistory.canGoForward())
      this.contents.navigationHistory.goForward();
    else if (action === 'reload') this.contents.reload();
    else if (action === 'stop') this.contents.stop();
  }
  check() {
    if (!this.alive()) throw new Error('内置浏览器已关闭，请重新打开网站。');
  }
  async evaluate(operation, input = {}) {
    this.check();
    const promise = this.contents.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `(() => { try { return { ok: true, value: (${domOperation.toString()})(${JSON.stringify(operation)},${JSON.stringify(input)}) }; } catch (error) { return { ok: false, error: String(error?.message || '网页操作失败。') }; } })()`,
      },
    ]);
    let timer;
    try {
      const result = await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('网页操作超时，请检查内置浏览器。')), 10000);
        }),
      ]);
      if (!result?.ok) throw new Error(result?.error || '网页操作失败。');
      return result.value;
    } finally {
      clearTimeout(timer);
    }
  }
  async goto(url, signal) {
    this.check();
    signal?.throwIfAborted();
    testUrl(url, this.automationOrigin || undefined);
    let timer;
    const stop = () => {
      if (this.alive()) this.contents.stop();
    };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await Promise.race([
        this.contents.loadURL(url),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            stop();
            reject(new Error('网站加载超过30秒。'));
          }, 30000);
        }),
      ]);
      signal?.throwIfAborted();
      testUrl(this.contents.getURL(), this.automationOrigin || undefined);
      if (this.automationError) throw new Error(this.automationError);
    } catch (error) {
      throw new Error(
        signal?.aborted
          ? '测试已取消。'
          : `网站加载失败：${redact(error.message, this.secrets).slice(0, 300)}`,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }
  async snapshot() {
    const result = await this.evaluate('snapshot');
    testUrl(result.url);
    if (
      [...new URL(result.url).searchParams.keys()].some((key) =>
        /^(?:access_token|refresh_token|id_token|token|password|code|authorization)$/i.test(key),
      )
    )
      throw new Error('当前页面包含登录验证参数，请完成登录并进入业务页面后再生成测试计划。');
    return redactObject(result, this.secrets);
  }
  async fillCredential(origin, credentials) {
    this.check();
    if (this.automationOrigin || this.contents.isLoading())
      throw new Error('请等待页面加载或测试结束后再填入。');
    if (new URL(this.contents.getURL()).origin !== origin)
      throw new Error('网站已变化，未填入密码。');
    // Retain only in memory for redacting later page snapshots and test evidence.
    this.secrets = [...new Set([...this.secrets, credentials.password].filter(Boolean))];
    let timer;
    const pending = this.contents.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `(() => { try { return { ok: true, message: (${fillLoginForm.toString()})(${JSON.stringify({ origin, ...credentials })}) }; } catch (error) { return { ok: false, message: String(error?.message || '填入失败，请手动填写。') }; } })()`,
      },
    ]);
    try {
      const result = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('填入超时，请检查登录页面后重试。')), 10000);
        }),
      ]);
      if (!result?.ok) throw new Error(result?.message || '填入失败，请手动填写。');
    } catch (error) {
      throw new Error(redact(error.message || '填入失败，请手动填写。', this.secrets));
    } finally {
      clearTimeout(timer);
    }
  }
  async perform(step, signal) {
    this.check();
    signal?.throwIfAborted();
    testUrl(this.contents.getURL(), this.automationOrigin || undefined);
    if (this.automationError) throw new Error(this.automationError);
    if (step.action === 'goto') {
      await this.goto(step.value, signal);
      return '已打开同站点网址。';
    }
    if (step.action === 'wait') {
      await delay(step.milliseconds, undefined, { signal });
      return '等待完成。';
    }
    const until = Date.now() + 8000;
    while (true) {
      signal?.throwIfAborted();
      try {
        const result = await this.evaluate('step', step);
        if (!step.action.startsWith('assert')) await delay(400, undefined, { signal });
        if (this.automationError) throw new Error(this.automationError);
        return redact(result, this.secrets);
      } catch (error) {
        if (!step.action.startsWith('assert') || Date.now() >= until)
          throw new Error(redact(error.message, this.secrets).slice(0, 500));
        await delay(200, undefined, { signal });
      }
    }
  }
  close() {
    for (const item of this.downloads) item.cancel();
    if (this.parent && !this.parent.isDestroyed())
      this.parent.contentView.removeChildView(this.view);
    this.parent = null;
    if (this.alive()) {
      this.contents.session.flushStorageData();
      void this.contents.session.cookies.flushStore().catch(() => {});
      this.contents.close({ waitForBeforeUnload: false });
    }
    this.secrets = [];
  }
}
