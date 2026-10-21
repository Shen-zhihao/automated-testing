import { normalizeContent } from './documents/content.mjs';
import { FeishuApi, FeishuApiError } from './feishu/api.mjs';
import { renderFeishuBlocks } from './feishu/preview.mjs';
import { loadFeishuImages } from './feishu/images.mjs';

export function parseFeishuUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('请输入完整的飞书文档或知识库链接。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !/(^|\.)feishu\.cn$/.test(url.hostname)
  )
    throw new Error('当前支持 feishu.cn 的 HTTPS 文档链接。');
  const match = url.pathname.match(/^\/(docx|wiki)\/([A-Za-z0-9]+)\/?$/);
  if (!match)
    throw new Error('请使用新版文档（/docx/）或知识库（/wiki/）链接。其他格式请先导出为本地文件。');
  return { url: `${url.origin}/${match[1]}/${match[2]}`, type: match[1], token: match[2] };
}

const emptyConfig = () => ({ appId: '', appSecret: '' });
const text = (value, max = 8000) =>
  typeof value === 'string' && value.length <= max ? value.trim() : '';
const isExpiredToken = (error) =>
  error instanceof FeishuApiError && [99991663, 99991665].includes(error.code);

function tokenFromResponse(data, now) {
  if (
    !text(data.access_token, 65536) ||
    /\s/.test(data.access_token) ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    !Number.isFinite(now + data.expires_in * 1000)
  )
    throw new Error('飞书未返回有效的应用访问凭证，请重试测试连接。');
  const lifetime = data.expires_in * 1000;
  return {
    accessToken: data.access_token,
    expiresAt: now + lifetime,
    renewAt: now + lifetime - Math.min(60000, lifetime / 10),
  };
}

export class FeishuService {
  constructor(settings, { notify = () => {}, fetchImpl, now = Date.now } = {}) {
    Object.assign(this, { settings, notify, now });
    this.api = new FeishuApi(fetchImpl);
    this.generation = 0;
    this.controller = new AbortController();
    this.testController = null;
    this.testPromise = null;
    this.tokenPromise = null;
    this.cachedToken = null;
    this.closed = false;
    // 仅保留本应用已加密的凭据，移除旧用户授权和回调配置。
    const { connectorPath, ...previous } = settings.stored();
    const config = previous.feishu;
    const legacyConfig =
      config && Object.keys(config).some((key) => !['appId', 'appSecret'].includes(key));
    if (connectorPath !== undefined || legacyConfig) {
      settings.store.writeSettings({
        ...previous,
        ...(config
          ? { feishu: { appId: config.appId ?? '', appSecret: config.appSecret ?? '' } }
          : {}),
      });
    }
  }
  stored() {
    return this.settings.stored().feishu ?? emptyConfig();
  }
  status() {
    const config = this.stored();
    return {
      configured: Boolean(config.appId && config.appSecret),
      appId: config.appId,
      hasAppSecret: Boolean(config.appSecret),
      connected: Boolean(this.cachedToken && this.cachedToken.expiresAt > this.now()),
      testing: Boolean(this.testPromise),
    };
  }
  assertActive(generation = this.generation) {
    if (this.closed || generation !== this.generation)
      throw new Error('飞书配置已改变或操作已取消，请重试。');
  }
  invalidate() {
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.cachedToken = null;
    this.tokenPromise = null;
  }
  async decryptSecret(encrypted) {
    try {
      return await this.settings.vault.decrypt(Buffer.from(encrypted, 'base64'));
    } catch {
      throw new Error('无法解密飞书应用密钥，请重新填写 App Secret 并测试连接。');
    }
  }
  async credentials() {
    const config = this.stored();
    if (!config.appId || !config.appSecret)
      throw new Error('请先在设置中填写飞书 App ID 和 App Secret，并测试连接。');
    return { appId: config.appId, appSecret: await this.decryptSecret(config.appSecret) };
  }
  testConnection(input) {
    if (this.testPromise) return Promise.reject(new Error('正在测试飞书连接，请稍候。'));
    if (this.closed) return Promise.reject(new Error('飞书操作已取消。'));
    this.testController = new AbortController();
    this.testPromise = this.performTest(input, this.testController.signal);
    this.notify();
    return this.testPromise
      .finally(() => {
        this.testPromise = null;
        this.testController = null;
        this.notify();
      })
      .then(() => this.status());
  }
  async performTest(input, signal) {
    if (!input || typeof input !== 'object') throw new Error('飞书应用配置无效。');
    const appId = text(input.appId, 150);
    if (!/^cli_[a-zA-Z0-9_-]{3,100}$/.test(appId))
      throw new Error('请输入飞书自建应用的 App ID（cli_ 开头）。');
    if (typeof input.appSecret !== 'string' || input.appSecret.length > 8000)
      throw new Error('App Secret 格式无效。');
    const previous = this.stored();
    const secret = input.appSecret.trim();
    let encrypted = appId === previous.appId ? previous.appSecret : '';
    if (!secret && !encrypted) throw new Error('首次配置或更换 App ID 时，请填写 App Secret。');
    const appSecret = secret || (await this.decryptSecret(encrypted));
    signal.throwIfAborted();
    const token = tokenFromResponse(await this.api.token({ appId, appSecret }, signal), this.now());
    if (secret) encrypted = (await this.settings.vault.encrypt(secret)).toString('base64');
    signal.throwIfAborted();
    this.assertActive();
    // 连接成功且加密完成后才替换配置，失败不会覆盖此前可用的凭据。
    this.settings.store.writeSettings({
      ...this.settings.stored(),
      feishu: { appId, appSecret: encrypted },
    });
    this.invalidate();
    this.cachedToken = token;
  }
  async accessToken() {
    this.assertActive();
    if (this.cachedToken?.renewAt > this.now()) return this.cachedToken.accessToken;
    if (!this.tokenPromise) {
      const task = this.acquireToken(this.generation, this.controller.signal).finally(() => {
        if (this.tokenPromise === task) this.tokenPromise = null;
      });
      this.tokenPromise = task;
    }
    return this.tokenPromise;
  }
  async acquireToken(generation, signal) {
    try {
      const config = await this.credentials();
      this.assertActive(generation);
      const data = await this.api.token(config, signal);
      this.assertActive(generation);
      this.cachedToken = tokenFromResponse(data, this.now());
      this.notify();
      return this.cachedToken.accessToken;
    } catch (error) {
      if (generation === this.generation) {
        this.cachedToken = null;
        this.notify();
      }
      throw error;
    }
  }
  forgetToken(token) {
    if (this.cachedToken?.accessToken === token) {
      this.cachedToken = null;
      this.notify();
    }
  }
  async read(input) {
    const parsed = parseFeishuUrl(input);
    const signal = this.controller.signal;
    let token = await this.accessToken();
    signal.throwIfAborted();
    const request = async (operation) => {
      const requestToken = token;
      try {
        return await operation(requestToken);
      } catch (error) {
        if (!isExpiredToken(error) || signal.aborted) throw error;
        this.forgetToken(requestToken);
        const renewed = await this.accessToken();
        token = renewed;
        signal.throwIfAborted();
        try {
          return await operation(renewed);
        } catch (retryError) {
          if (isExpiredToken(retryError)) this.forgetToken(renewed);
          throw retryError;
        }
      }
    };
    const get = (resource) => request((accessToken) => this.api.get(resource, accessToken, signal));
    let documentId = parsed.token;
    if (parsed.type === 'wiki') {
      const data = await get(
        `/wiki/v2/spaces/get_node?token=${encodeURIComponent(documentId)}&obj_type=wiki`,
      );
      if (data.node?.obj_type !== 'docx')
        throw new Error('此知识库链接指向的不是新版文档，请导出为本地文件后导入。');
      documentId = data.node.obj_token;
    }
    if (typeof documentId !== 'string' || !/^[A-Za-z0-9]+$/.test(documentId))
      throw new Error('飞书未返回有效的文档标识。');
    const root = `/docx/v1/documents/${encodeURIComponent(documentId)}`;
    const [info, body] = await Promise.all([get(root), get(`${root}/raw_content`)]);
    signal.throwIfAborted();
    const warnings = [];
    let preview = null;
    try {
      const blocks = [];
      const seenPages = new Set();
      const revision = Number.isInteger(info.document?.revision_id)
        ? info.document.revision_id
        : -1;
      let pageToken = '';
      do {
        const page = await get(
          `${root}/blocks?page_size=500&document_revision_id=${revision}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`,
        );
        signal.throwIfAborted();
        if (!Array.isArray(page.items)) throw new Error('飞书没有返回文档结构。');
        blocks.push(...page.items);
        if (blocks.length > 20000) throw new Error('飞书文档结构超过 2 万个块。');
        pageToken = page.has_more ? page.page_token : '';
        if (
          page.has_more &&
          (typeof pageToken !== 'string' ||
            !pageToken ||
            pageToken.length > 4000 ||
            seenPages.has(pageToken))
        )
          throw new Error('飞书文档分页异常。');
        seenPages.add(pageToken);
      } while (pageToken);
      if (!blocks.length) throw new Error('飞书文档结构为空。');
      const images = await loadFeishuImages(
        blocks,
        (imageToken, imageSignal, limit) =>
          request((accessToken) =>
            this.api.downloadImage(imageToken, documentId, accessToken, imageSignal, limit),
          ),
        signal,
        warnings,
      );
      signal.throwIfAborted();
      preview = renderFeishuBlocks(
        blocks,
        documentId,
        info.document?.title ?? '',
        warnings,
        images,
      );
    } catch (error) {
      signal.throwIfAborted();
      warnings.push(`格式预览未获取成功，已保留完整纯文字，可稍后重新提取格式。${error.message}`);
    }
    signal.throwIfAborted();
    return {
      name: text(info.document?.title, 2000) || '飞书文档',
      source: parsed.url,
      kind: 'feishu',
      content: normalizeContent(body.content),
      preview,
      warnings,
    };
  }
  async close() {
    this.closed = true;
    const pending = [this.testPromise, this.tokenPromise].filter(Boolean);
    this.testController?.abort();
    this.invalidate();
    await Promise.allSettled(pending);
  }
}
