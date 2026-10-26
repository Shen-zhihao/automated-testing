// 首次 AI 操作才加载 Mastra，避免框架初始化阻塞桌面首屏。
let engine;
async function loadEngine() {
  // 桌面产品仅向用户配置的服务发起模型请求，关闭框架使用情况遥测。
  process.env.MASTRA_TELEMETRY_DISABLED = '1';
  engine ??= import('./engine.mjs').catch((error) => {
    engine = undefined;
    throw error;
  });
  return engine;
}

export async function generateText(config, messages, options) {
  return (await loadEngine()).generateText(config, messages, options);
}

export async function runWorkflow(id, operations, options = {}, inputData = {}) {
  try {
    options.signal?.throwIfAborted();
    return await (await loadEngine()).runWorkflow(id, operations, options, inputData);
  } catch (error) {
    if (options.signal?.aborted) throw new Error('操作已取消。');
    throw error;
  }
}

export async function runTextLoop(iterate, options = {}) {
  return runWorkflow('text-continuation', { iterate }, options, { round: 0, done: false });
}

export async function runTool(id, input, execute, options = {}) {
  options.signal?.throwIfAborted();
  return (await loadEngine()).runTool(id, input, execute, options);
}
