import { AGENT_RULES } from './agent-policy.mjs';
import { readJsonResponse } from './http.mjs';
import { messageCharacters } from './context.mjs';

export function modelMessages(messages) {
  return messages[0]?.role === 'system'
    ? [{ ...messages[0], content: AGENT_RULES + '\n' + messages[0].content }, ...messages.slice(1)]
    : [{ role: 'system', content: AGENT_RULES }, ...messages];
}

export async function completePart(
  config,
  messages,
  {
    signal,
    fetchImpl = fetch,
    maxTokens = config.maxTokens,
    reasoningEffort,
    inputCharacterLimit,
  } = {},
) {
  messages = modelMessages(messages);
  if (inputCharacterLimit && messageCharacters(messages) > inputCharacterLimit)
    throw new Error('本轮上下文超过本机请求预算，请缩小问题或引用资料范围后重试；历史记录保留。');
  const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const responses = config.format === 'responses';
  const body = responses
    ? { model: config.model, input: messages, max_output_tokens: maxTokens, store: false }
    : { model: config.model, messages, [config.tokenParameter]: maxTokens, stream: false };
  if (config.temperature !== null) body.temperature = config.temperature;
  // DeepSeek 默认开启 high 思考，有限输出额度可能在返回正文前耗尽。
  // 仅为明确要求直接输出的任务映射官方支持的开关，不向其他兼容服务透传。
  if (
    reasoningEffort === 'none' &&
    new URL(config.baseUrl).hostname === 'api.deepseek.com' &&
    ['deepseek-flash', 'deepseek-v4-pro'].includes(config.model)
  ) {
    if (responses) body.reasoning = { effort: 'none' };
    else body.thinking = { type: 'disabled' };
  }
  let response;
  try {
    response = await fetchImpl(
      `${config.baseUrl}/${responses ? 'responses' : 'chat/completions'}`,
      {
        method: 'POST',
        redirect: 'error',
        signal: requestSignal,
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      const reasons = {
        400: '请求参数不兼容，请检查接口格式、模型名称、输出 Token 参数和温度设置',
        401: 'API Key 无效或已过期',
        403: '当前账号无权访问该模型',
        404: '接口或模型不存在，请检查服务地址和模型名称',
        429: '请求过于频繁或额度不足',
      };
      throw new Error(
        `模型请求失败（${response.status}）：${reasons[response.status] ?? '服务暂时不可用，请稍后重试'}。`,
      );
    }
    const data = await readJsonResponse(response, 16 * 1024 * 1024);
    let text;
    let truncated = false;
    if (responses) {
      if (data.status === 'incomplete') {
        if (data.incomplete_details?.reason !== 'max_output_tokens')
          throw new Error('模型服务未能完成本次内容，不能将不完整结果保存为成功。');
        truncated = true;
      }
      if (data.output?.some((item) => item.content?.some((part) => part.type === 'refusal')))
        throw new Error('模型服务拒绝了本次内容，请检查文档或更换模型。');
      if (data.error || data.status === 'failed') throw new Error('模型服务未能完成分析。');
      if (!truncated && data.status !== 'completed')
        throw new Error('模型服务尚未完成本次生成，请重试；已有结果保留。');
      text = data.output
        ?.flatMap((item) => item.content ?? [])
        .filter((item) => item.type === 'output_text')
        .map((item) => item.text)
        .join('\n');
    } else {
      const choice = data.choices?.[0];
      truncated = choice?.finish_reason === 'length';
      if (!['stop', 'length'].includes(choice?.finish_reason)) {
        if (choice?.finish_reason !== 'content_filter')
          throw new Error('模型服务中断了本次生成，请重试；已有结果保留。');
      }
      if (choice?.message?.refusal || choice?.finish_reason === 'content_filter')
        throw new Error('模型服务拒绝了本次内容，请检查文档或更换模型。');
      text = choice?.message?.content;
    }
    if (typeof text !== 'string' || !text.trim()) {
      if (truncated)
        throw new Error(
          '本次输出额度已耗尽，但没有返回正文，可能被模型推理消耗。请提高最大输出 Token 后继续；已完成的步骤保留。',
        );
      throw new Error('模型没有返回可读取的文本，请检查模型是否支持当前接口。');
    }
    if (text.length > 2000000) throw new Error('模型返回文本过长，请降低最大输出 Token。');
    return { text, truncated };
  } catch (error) {
    if (signal?.aborted) throw new Error('分析已取消。');
    if (timeout.aborted)
      throw new Error(`模型请求超过 ${config.timeoutSeconds} 秒，请重试或调整超时设置。`);
    if (error instanceof TypeError)
      throw new Error('无法连接模型服务，请检查地址、网络和本地模型是否启动。');
    throw error;
  }
}

export async function complete(config, messages, options) {
  const result = await completePart(config, messages, options);
  if (result.truncated) throw new Error('模型输出被截断，请分段生成或提高最大输出 Token 后重试。');
  return result.text.trim();
}
