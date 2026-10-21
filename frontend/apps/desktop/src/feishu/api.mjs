import { readJsonResponse } from '../http.mjs';
import { ImagePreviewError, MAX_IMAGE_BYTES, readImageResponse } from './images.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export const API_ORIGIN = 'https://open.feishu.cn/open-apis';
export const TOKEN_URL = 'https://accounts.feishu.cn/oauth/v3/token';

export class FeishuApiError extends Error {
  constructor(code, status) {
    const details = {
      20002: '应用凭据不正确，请检查 App ID 和 App Secret。',
      20009: '企业尚未安装此飞书应用，请联系应用管理员。',
      20048: '找不到此应用，请检查 App ID。',
      20068: '应用缺少所需权限，请开通应用身份的只读权限并发布。',
      20069: '飞书应用尚未启用，请完成发布和管理员审批。',
      20130: '应用认证失败，请检查 App ID、App Secret 和应用认证方式。',
      20140: '应用不支持此认证方式，请在飞书后台启用 client_secret_post。',
      99991662: '飞书应用已停用，请联系应用管理员。',
      99991663: '应用访问凭证无效，请重新测试连接。',
      99991665: '应用访问凭证无效，请重新测试连接。',
      99991672: '应用缺少所需权限，请开通应用身份的文档、知识库只读权限并发布。',
      99991676: '应用缺少所需权限，请检查已发布的应用身份权限。',
      99991679: '应用缺少所需权限，请检查已发布的应用身份权限。',
      1770032: '应用无权读取此文档，请在文档中添加该应用并授予阅读权限；知识库需同时授予访问权限。',
      91403: '应用无权读取此文档，请在文档中添加该应用并授予阅读权限；知识库需同时授予访问权限。',
    };
    const message =
      details[code] ||
      (status === 429
        ? '请求过于频繁，请稍后重试。'
        : status === 403
          ? '应用无权访问，请检查应用身份的接口权限，并为应用授予目标文档或知识库的阅读权限。'
          : status >= 500
            ? '飞书服务暂不可用，请稍后重试。'
            : '请求失败，请检查应用配置、文档权限或重新测试连接。');
    super(`飞书：${message}${Number.isSafeInteger(code) ? `（错误码 ${code}）` : ''}`);
    this.code = code;
    this.status = status;
  }
}
export class FeishuApi {
  constructor(fetchImpl = fetch) {
    this.fetch = fetchImpl;
    this.nextImageRequestAt = 0;
  }
  async request(url, options, signal, readBody = readJsonResponse) {
    try {
      const response = await this.fetch(url, {
        ...options,
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
      let body;
      try {
        body = await readBody(response);
      } catch (error) {
        if (error instanceof ImagePreviewError) throw error;
        throw new FeishuApiError(null, response.status);
      }
      if (!body || typeof body !== 'object' || !response.ok || body.code || body.error)
        throw new FeishuApiError(body?.code, response.status);
      return body.data ?? body;
    } catch (error) {
      if (signal?.aborted) throw new Error('飞书操作已取消。');
      if (error instanceof FeishuApiError || error instanceof ImagePreviewError) throw error;
      throw new Error('无法连接飞书，或请求超时。请检查网络后重试。');
    }
  }
  token({ appId, appSecret }, signal) {
    return this.request(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: appId,
          client_secret: appSecret,
        }),
      },
      signal,
    );
  }
  get(resource, accessToken, signal) {
    // 应用令牌只发往固定的官方只读接口，不发往文档分享域名。
    if (
      !/^\/(?:docx\/v1\/documents\/[A-Za-z0-9]+(?:\/raw_content|\/blocks\?page_size=500&document_revision_id=(?:-1|\d+)(?:&page_token=[A-Za-z0-9%_.~!\-]+)?)?|wiki\/v2\/spaces\/get_node\?token=[A-Za-z0-9]+&obj_type=wiki)$/.test(
        resource,
      )
    )
      throw new Error('不支持的飞书接口。');
    return this.request(
      `${API_ORIGIN}${resource}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      signal,
    );
  }
  async downloadImage(fileToken, documentId, accessToken, signal, limit = MAX_IMAGE_BYTES) {
    if (!/^[A-Za-z0-9]{1,256}$/.test(fileToken) || !/^[A-Za-z0-9]+$/.test(documentId))
      throw new Error('飞书图片标识无效。');
    // 带上所属文档上下文；令牌仍只发送到固定的官方素材接口，禁止跟随重定向。
    const extra = encodeURIComponent(JSON.stringify({ doc_id: documentId, doc_type: 'docx' }));
    // 重试和并发读取共享节流窗口；素材接口上限为 5 QPS。
    const requestAt = Math.max(Date.now(), this.nextImageRequestAt);
    this.nextImageRequestAt = requestAt + 250;
    await delay(Math.max(0, requestAt - Date.now()), undefined, { signal });
    return this.request(
      `${API_ORIGIN}/drive/v1/medias/${fileToken}/download?extra=${extra}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      signal,
      async (response) => {
        if (!response.ok || /\bjson\b/i.test(response.headers.get('content-type') ?? '')) {
          const body = await readJsonResponse(response);
          if (response.ok && !body?.code && !body?.error)
            throw new ImagePreviewError('素材接口未返回图片内容');
          return body;
        }
        return readImageResponse(response, Math.min(MAX_IMAGE_BYTES, limit));
      },
    ).catch((error) => {
      if (
        error instanceof FeishuApiError &&
        (error.status === 403 ||
          [20068, 99991672, 99991676, 99991679, 1770032, 91403].includes(error.code))
      )
        throw new ImagePreviewError(
          '应用无权下载图片，请开通素材下载只读权限并发布，确认目标文档允许应用阅读和下载',
        );
      throw error;
    });
  }
}
