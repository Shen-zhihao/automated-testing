import { createTextWriter, hash } from '../analysis-text.mjs';

export function createTestWriter(kind, context, config, options, system) {
  // 调整输出额度和超时后可继续；更换材料、模型或服务后重新生成。不保存密钥。
  const fingerprint = hash({
    version: 1,
    kind,
    context,
    baseUrl: config.baseUrl,
    model: config.model,
    format: config.format,
    tokenParameter: config.tokenParameter,
    temperature: config.temperature,
    system,
  });
  const state =
    options.checkpoint?.fingerprint === fingerprint
      ? structuredClone(options.checkpoint)
      : { fingerprint, steps: {}, total: 0 };
  options.signal?.throwIfAborted();
  options.onCheckpoint?.(state);
  return {
    state,
    write: createTextWriter(config, state, {
      ...options,
      system,
      agentId: kind === 'plan' ? 'planner' : 'testing',
      correction: '仅输出当前任务要求的结构，保留全部来源和关联，不编造新需求或测试结果。',
    }),
  };
}

// 渲染进程只读取进度；模型正文、指纹和提示哈希留在主进程。
export function testGenerationView(checkpoint) {
  if (
    !checkpoint ||
    !Object.values(checkpoint.steps).some((step) => step.text || step.previousText)
  )
    return null;
  return {
    completed: Object.entries(checkpoint.steps).filter(
      ([key, step]) => key.startsWith('output:') && step.complete,
    ).length,
    total: checkpoint.total,
    ...(checkpoint.caseIds ? { caseIds: [...checkpoint.caseIds] } : {}),
  };
}
