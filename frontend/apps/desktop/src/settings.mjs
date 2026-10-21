export const DEFAULT_MODEL = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  format: 'chat-completions',
  tokenParameter: 'max_tokens',
  maxTokens: 4096,
  temperature: null,
  timeoutSeconds: 120,
};

export function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入有效的模型服务地址。');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      '服务地址须使用 HTTPS；本机服务支持 http://localhost 或 http://127.0.0.1。地址中不要包含密钥、查询参数或账号。',
    );
  }
  url.pathname = url.pathname
    .replace(/\/(chat\/completions|responses)\/?$/, '')
    .replace(/\/+$/, '');
  return url.href.replace(/\/+$/, '');
}

function string(value, label, max = 500) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式无效。`);
  return value.trim();
}

export function validateModel(input) {
  if (!input || typeof input !== 'object') throw new Error('模型配置无效。');
  const baseUrl = normalizeBaseUrl(string(input.baseUrl, '服务地址', 2000));
  const model = string(input.model, '模型名称', 200);
  if (!['chat-completions', 'responses'].includes(input.format)) throw new Error('接口格式无效。');
  if (!['max_tokens', 'max_completion_tokens'].includes(input.tokenParameter))
    throw new Error('输出参数无效。');
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 512 || input.maxTokens > 393216)
    throw new Error('最大输出 Token 需在 512–393216 之间，并且不超过所选模型的输出上限。');
  if (
    !Number.isInteger(input.timeoutSeconds) ||
    input.timeoutSeconds < 15 ||
    input.timeoutSeconds > 600
  )
    throw new Error('超时时间需在 15–600 秒之间。');
  if (
    input.temperature !== null &&
    (typeof input.temperature !== 'number' ||
      !Number.isFinite(input.temperature) ||
      input.temperature < 0 ||
      input.temperature > 2)
  )
    throw new Error('温度需留空或在 0–2 之间。');
  return {
    baseUrl,
    model,
    format: input.format,
    tokenParameter: input.tokenParameter,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    timeoutSeconds: input.timeoutSeconds,
  };
}

export class SettingsService {
  constructor(store, vault) {
    this.store = store;
    this.vault = vault;
    this.pending = Promise.resolve();
  }
  stored() {
    return this.store.readSettings() ?? { model: DEFAULT_MODEL, apiKey: '' };
  }
  public() {
    const { model, apiKey } = this.stored();
    return { model, hasApiKey: Boolean(apiKey) };
  }
  save(input) {
    const operation = this.pending.then(async () => {
      const model = validateModel(input.model);
      const previous = this.stored();
      let apiKey = previous.apiKey;
      const key = string(input.apiKey ?? '', 'API Key', 8000);
      // 地址变更时不把旧凭据隐式发送给新的服务。
      if (input.clearApiKey || previous.model.baseUrl !== model.baseUrl) apiKey = '';
      if (key) apiKey = (await this.vault.encrypt(key)).toString('base64');
      this.store.writeSettings({ ...this.stored(), model, apiKey });
      return this.public();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  async modelConfig() {
    const { model, apiKey } = this.stored();
    if (!model.model) throw new Error('请先在设置中填写模型名称并保存。');
    let key = '';
    try {
      if (apiKey) key = await this.vault.decrypt(Buffer.from(apiKey, 'base64'));
    } catch {
      throw new Error('无法解密 API Key，请在设置中重新填写并保存。');
    }
    return { ...validateModel(model), apiKey: key };
  }
}
