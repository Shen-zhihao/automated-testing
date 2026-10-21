import {
  AGENT_RULES,
  reviewScope,
  explicitBypass,
  SCOPE_REFUSAL,
  SAFETY_REFUSAL,
} from './agent-policy.mjs';
import { readJsonResponse } from './http.mjs';
import {
  REQUIREMENTS_SYSTEM,
  REQUIREMENTS_REPORT,
  HTML_PROTOTYPE_CONTEXT,
  HTML_PROTOTYPE_REPORT,
  buildImplementationReport,
} from './requirements.mjs';

export async function complete(
  config,
  messages,
  { signal, fetchImpl = fetch, maxTokens = config.maxTokens } = {},
) {
  messages =
    messages[0]?.role === 'system'
      ? [
          { ...messages[0], content: AGENT_RULES + '\n' + messages[0].content },
          ...messages.slice(1),
        ]
      : [{ role: 'system', content: AGENT_RULES }, ...messages];
  const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const responses = config.format === 'responses';
  const body = responses
    ? { model: config.model, input: messages, max_output_tokens: maxTokens, store: false }
    : { model: config.model, messages, [config.tokenParameter]: maxTokens, stream: false };
  if (config.temperature !== null) body.temperature = config.temperature;
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
    if (responses) {
      if (data.status === 'incomplete')
        throw new Error('模型输出未完成，请提高最大输出 Token 或减少分析内容。');
      if (data.error || data.status === 'failed') throw new Error('模型服务未能完成分析。');
      text = data.output
        ?.flatMap((item) => item.content ?? [])
        .filter((item) => item.type === 'output_text')
        .map((item) => item.text)
        .join('\n');
    } else {
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length')
        throw new Error('模型输出被截断，请提高最大输出 Token 后重试。');
      if (choice?.message?.refusal || choice?.finish_reason === 'content_filter')
        throw new Error('模型服务拒绝了本次内容，请检查文档或更换模型。');
      text = choice?.message?.content;
    }
    if (typeof text !== 'string' || !text.trim())
      throw new Error('模型没有返回可读取的文本，请检查模型是否支持当前接口。');
    if (text.length > 2000000) throw new Error('模型返回文本过长，请降低最大输出 Token。');
    return text.trim();
  } catch (error) {
    if (signal?.aborted) throw new Error('分析已取消。');
    if (timeout.aborted)
      throw new Error(`模型请求超过 ${config.timeoutSeconds} 秒，请重试或调整超时设置。`);
    if (error instanceof TypeError)
      throw new Error('无法连接模型服务，请检查地址、网络和本地模型是否启动。');
    throw error;
  }
}

export function reviewAgentScope(config, context, options = {}) {
  return reviewScope(
    (messages, maxTokens) =>
      complete(config, messages, { ...options, maxTokens: Math.min(config.maxTokens, maxTokens) }),
    context,
  );
}

export function splitText(text, size = 12000) {
  const chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > start + size / 2) end = newline + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export async function analyzeDocument(
  document,
  goal,
  config,
  { signal, onProgress = () => {}, fetchImpl } = {},
) {
  if (typeof goal !== 'string' || goal.length > 4000)
    throw new Error('分析重点请限制在 4000 字符以内。');
  if (explicitBypass(goal)) throw new Error(SAFETY_REFUSAL);
  {
    const decision = await reviewAgentScope(
      config,
      {
        kind: 'request',
        project: document.name,
        source: document.content.slice(0, 10000),
        request: goal.trim() || '分析本工程需求的功能实现步骤和验收标准',
      },
      { signal, fetchImpl },
    );
    if (decision !== 'allow')
      throw new Error(decision === 'unsafe' ? SAFETY_REFUSAL : SCOPE_REFUSAL);
  }
  const request = (content, maxTokens) =>
    complete(
      config,
      [
        { role: 'system', content: REQUIREMENTS_SYSTEM },
        { role: 'user', content },
      ],
      { signal, fetchImpl, maxTokens },
    );
  const chunks = splitText(document.content);
  const isPrototype = ['html', 'htm'].includes(document.kind);
  const context = `文档：${document.name}\n用户分析重点：${goal.trim() || '拆分功能实现步骤和可判定的功能验收标准'}\n${isPrototype ? HTML_PROTOTYPE_CONTEXT + '\n' : ''}`;
  let material = document.content;
  if (chunks.length > 1) {
    const notes = [];
    for (const [index, chunk] of chunks.entries()) {
      signal?.throwIfAborted();
      onProgress(`正在阅读第 ${index + 1} / ${chunks.length} 段`);
      notes.push(
        await request(
          `${context}为后续生成实现步骤与验收标准，逐个提取本段全部功能、角色、输入输出、业务规则、依赖、状态变化、异常、边界数值及单位、验收要点和待确认问题。使用紧凑条目去除重复描述，但不得遗漏独有需求；保留原文短句、已有章节及“分段 ${index + 1}”引用编号。此时不跨分段分配最终 F/S/AC 编号。\n<文档分段 ${index + 1}>\n${chunk}\n</文档分段>`,
          Math.min(config.maxTokens, 8192),
        ),
      );
    }
    material = notes.join('\n\n');
    // 分层汇总覆盖全部分段，不直接截断长文档或中间结果。
    for (let round = 0; material.length > 18000; round++) {
      if (round >= 4) throw new Error('中间分析过长，无法可靠汇总，请缩小文档范围后重试。');
      const groups = splitText(material);
      const summaries = [];
      for (const [index, group] of groups.entries()) {
        onProgress(`正在汇总第 ${round + 1} 轮 · ${index + 1} / ${groups.length}`);
        summaries.push(
          await request(
            `${context}合并以下分析笔记，删除重复措辞并压缩表达，逐项保留所有独有功能、实施依赖、验收规则、状态变化、异常、数值边界及单位、待确认问题与原文分段引用；不要把独有需求合并成模糊摘要。\n<分析笔记>\n${group}\n</分析笔记>`,
            Math.min(config.maxTokens, 8192),
          ),
        );
      }
      material = summaries.join('\n\n');
    }
  }
  onProgress('正在编写功能实现步骤与验收标准');
  const content = await request(
    `${context}${REQUIREMENTS_REPORT}\n${isPrototype ? HTML_PROTOTYPE_REPORT : ''}\n以下${chunks.length > 1 ? '材料是覆盖全文的分段分析笔记' : '材料是原文'}：\n<材料>\n${material}\n</材料>`,
    config.maxTokens,
  );
  return buildImplementationReport(document, content, {
    goal: goal.trim(),
    model: config.model,
    baseUrl: config.baseUrl,
    createdAt: new Date().toISOString(),
    segments: chunks.length,
  });
}
