import { AGENT_RULES } from './agent-policy.mjs';
import { messageCharacters } from './context.mjs';
import { generateText } from './mastra/runtime.mjs';

export function modelMessages(messages) {
  return messages[0]?.role === 'system'
    ? [{ ...messages[0], content: AGENT_RULES + '\n' + messages[0].content }, ...messages.slice(1)]
    : [{ role: 'system', content: AGENT_RULES }, ...messages];
}

// 保留业务调用契约；所有模型执行统一进入 Mastra Agent。
export async function completePart(config, messages, options = {}) {
  try {
    options.signal?.throwIfAborted();
    messages = modelMessages(messages);
    if (options.inputCharacterLimit && messageCharacters(messages) > options.inputCharacterLimit)
      throw new Error('本轮上下文超过本机请求预算，请缩小问题或引用资料范围后重试；历史记录保留。');
    return await generateText(config, messages, options);
  } catch (error) {
    if (options.signal?.aborted) throw new Error('分析已取消。');
    throw error;
  }
}

export async function complete(config, messages, options) {
  const result = await completePart(config, messages, options);
  if (result.truncated) throw new Error('模型输出被截断，请分段生成或提高最大输出 Token 后重试。');
  return result.text.trim();
}
