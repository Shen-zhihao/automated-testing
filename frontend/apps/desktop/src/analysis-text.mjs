import { createHash } from 'node:crypto';
import { completePart } from './model-client.mjs';
import { AGENT_RULES } from './agent-policy.mjs';
import { REQUIREMENTS_SYSTEM } from './requirements.mjs';

export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function splitText(text, size = 12000) {
  if (!Number.isInteger(size) || size < 2) throw new Error('分段大小无效。');
  const chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline > start + size / 2) end = newline + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

// 只回传当前任务和正文末尾，不把不断增长的完整报告塞回上下文。
export function createTextWriter(
  config,
  state,
  {
    signal,
    fetchImpl,
    onProgress = () => {},
    onCheckpoint,
    system = REQUIREMENTS_SYSTEM,
    correction = '编号从原始任务指定值开始，所有给定关联均需覆盖，不编造新需求，不写其他功能。',
  },
) {
  const persist = () => onCheckpoint?.(state);
  return async (key, label, prompt, validate = () => {}) => {
    signal?.throwIfAborted();
    const promptHash = hash(prompt);
    let step = state.steps[key];
    if (step?.promptHash !== promptHash) step = { promptHash, text: '', complete: false };
    state.steps[key] = step;
    if (step.complete) {
      validate(step.text);
      return step.text;
    }
    const rewrite = (error) => {
      step.previousText = step.text || step.previousText || '';
      step.text = '';
      step.validationError = error.message;
      persist();
    };
    onProgress(label);
    let corrections = 0;
    for (let round = 0; round < 12; round++) {
      signal?.throwIfAborted();
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ];
      if (step.validationError)
        messages[1].content += `\n<本机校验反馈>\n上次输出未通过校验：${step.validationError}\n请严格依据原始任务重新生成当前步骤的完整内容，修正上述问题；${correction}此前未通过的正文已作废。\n</本机校验反馈>`;
      const anchor = step.text.slice(-120);
      if (step.text) {
        onProgress(`${label} · 正在自动续写`);
        messages.push(
          { role: 'assistant', content: step.text.slice(-3000) },
          {
            role: 'user',
            content: `上条正文因输出额度被截断，展示的是末尾片段。继续完成当前任务，不重新开头、不重复已经写过的条目。先逐字输出以下 JSON 字符串解码后的衔接锚点，再从它最后一个字符后继续正文；保留空格、换行、编号和未闭合结构，不加解释或额外代码围栏。锚点：${JSON.stringify(anchor)}`,
          },
        );
      }
      // 字符预算是保守的请求边界，不冒充供应商精确的 Token 计数。
      if (
        AGENT_RULES.length + messages.reduce((size, message) => size + message.content.length, 0) >
        48000
      )
        throw new Error('当前步骤的材料过长，请拆分任务后重试；已完成步骤保留。');
      const result = await completePart(config, messages, {
        signal,
        fetchImpl,
        reasoningEffort: 'none',
      });
      signal?.throwIfAborted();
      let addition = result.text;
      if (anchor) {
        const at = addition.indexOf(anchor);
        if (at < 0 || addition.slice(0, at).trim()) {
          if (round < 1) continue;
          const error = new Error('模型续写未能衔接原文，需要完整重写当前段。');
          rewrite(error);
          if (corrections++ >= 2) throw error;
          onProgress(`${label} · 正在重写当前段（${corrections} / 2）`);
          continue;
        }
        addition = addition.slice(at + anchor.length);
      }
      if (!addition.trim()) {
        const error = new Error('模型续写没有新增内容，需要完整重写当前段。');
        rewrite(error);
        if (corrections++ >= 2) throw error;
        onProgress(`${label} · 正在重写当前段（${corrections} / 2）`);
        continue;
      }
      if (step.text.length + addition.length > 160000)
        throw new Error('单个步骤输出过长，请拆分任务；已完成步骤保留。');
      step.text += addition;
      if (!result.truncated) {
        try {
          validate(step.text);
        } catch (error) {
          // 仅重写当前不合格步骤；已完成的其他步骤和成功报告保持独立。
          rewrite(error);
          if (corrections++ >= 2) throw error;
          onProgress(`${label} · 正在修正输出（${corrections} / 2）`);
          continue;
        }
        step.complete = true;
        delete step.validationError;
        delete step.previousText;
      }
      persist();
      if (step.complete) return step.text;
    }
    throw new Error(
      '当前内容已连续续写 12 次，已保存进度。可点击继续生成，或调整单次输出额度后继续。',
    );
  };
}

export const createAnalysisWriter = createTextWriter;
