import { Mastra } from '@mastra/core/mastra';
import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createConfiguredModel } from './model-provider.mjs';

const agentNames = {
  assistant: '工程讨论',
  requirements: '需求分析',
  testing: '测试设计',
  planner: '网页测试计划',
  reviewer: '工程范围与安全审查',
  connection: '模型连接检查',
};
const agents = Object.fromEntries(
  Object.entries(agentNames).map(([id, name]) => [
    id,
    new Agent({
      id,
      name,
      instructions: '',
      model: ({ requestContext }) => requestContext.get('model'),
    }),
  ]),
);

const definitions = {
  'document-analysis': ['review-scope', 'generate-report'],
  'chat-answer': ['review-request', 'generate-answer', 'review-answer'],
  'chat-turn': ['answer', 'execute-commands', 'summarize'],
  'test-document': ['review-scope', 'prepare-material', 'generate-sections', 'assemble-document'],
  'browser-plan': ['read-page', 'generate-cases', 'validate-plan'],
};
const iterationDefinitions = {
  'text-continuation': ['iterate'],
  'browser-execution': ['execute-case'],
};
// 业务结果仍由原有 Schema 校验；凭据、回调和执行器仅存在于本次 RequestContext。
const valueSchema = z.unknown();
const workflowOptions = {
  shouldPersistSnapshot: () => false,
};
function operationStep(id) {
  return createStep({
    id,
    inputSchema: valueSchema,
    outputSchema: valueSchema,
    execute: async ({ inputData, requestContext, bail }) => {
      const { operations, options } = requestContext.get('execution');
      options.signal?.throwIfAborted();
      options.onRuntimeEvent?.({ type: 'step', id });
      try {
        const result = await operations[id](inputData, { bail });
        options.signal?.throwIfAborted();
        return result;
      } catch (error) {
        requestContext.set('failure', error);
        throw error;
      }
    },
  });
}
const workflows = Object.fromEntries(
  Object.entries(definitions).map(([id, steps]) => {
    let workflow = createWorkflow({
      id,
      inputSchema: valueSchema,
      outputSchema: valueSchema,
      retryConfig: { attempts: 0, delay: 0 },
      options: workflowOptions,
    });
    for (const step of steps) workflow = workflow.then(operationStep(step));
    return [id, workflow.commit()];
  }),
);
workflows['text-continuation'] = createWorkflow({
  id: 'text-continuation',
  inputSchema: z.object({ round: z.number().int().min(0), done: z.boolean() }),
  outputSchema: valueSchema,
  retryConfig: { attempts: 0, delay: 0 },
  options: workflowOptions,
})
  .dountil(
    operationStep('iterate'),
    async ({ inputData }) => inputData.done || inputData.round >= 12,
  )
  .commit();
workflows['browser-execution'] = createWorkflow({
  id: 'browser-execution',
  inputSchema: z.array(valueSchema),
  outputSchema: z.array(valueSchema),
  retryConfig: { attempts: 0, delay: 0 },
  options: workflowOptions,
})
  .foreach(operationStep('execute-case'), { concurrency: 1 })
  .commit();

const commandSchema = z.object({
  command: z.string().trim().min(1).max(2000),
  reason: z.string().trim().min(1).max(2000),
});
const browserSchema = z
  .object({
    action: z.enum([
      'goto',
      'click',
      'fill',
      'select',
      'check',
      'assertText',
      'assertUrl',
      'assertVisible',
      'wait',
    ]),
  })
  .passthrough();
const toolSchemas = { 'project-command': commandSchema, 'browser-action': browserSchema };
const tools = Object.fromEntries(
  Object.entries(toolSchemas).map(([id, inputSchema]) => [
    id,
    createTool({
      id,
      description:
        id === 'project-command'
          ? '提交本工程命令，经过现有权限检查后执行。'
          : '执行用户已审阅测试计划中的浏览器步骤。',
      inputSchema,
      outputSchema: valueSchema,
      execute: async (input, { requestContext }) => {
        const { execute, options } = requestContext.get('execution');
        options.signal?.throwIfAborted();
        const result = await execute(input);
        options.signal?.throwIfAborted();
        return result;
      },
    }),
  ]),
);

// 作为本地主进程库运行。不启用服务、Memory、第二套数据库或远程追踪。
export const mastra = new Mastra({ agents, workflows, tools, logger: false });

export async function generateText(config, messages, options = {}) {
  const { agentId = 'assistant', signal } = options;
  if (!Object.hasOwn(agentNames, agentId)) throw new Error('未知的模型任务。');
  signal?.throwIfAborted();
  const requestContext = new RequestContext();
  const model = createConfiguredModel(config, options);
  requestContext.set('model', model);
  let failure;
  try {
    options.onRuntimeEvent?.({ type: 'agent', id: agentId });
    const result = await mastra.getAgent(agentId).generate(messages.slice(1), {
      instructions: messages[0].content,
      requestContext,
      abortSignal: signal,
      maxSteps: 1,
      modelSettings: { maxRetries: 0, maxOutputTokens: options.maxTokens ?? config.maxTokens },
      returnScorerData: false,
      onError: ({ error }) => {
        failure = error;
      },
    });
    signal?.throwIfAborted();
    if (failure) throw failure;
    if (!['stop', 'length'].includes(result.finishReason))
      throw new Error('模型服务中断了本次生成，请重试；已有结果保留。');
    if (!result.text?.trim())
      throw new Error('模型没有返回可读取的文本，请检查模型是否支持当前接口。');
    return { text: result.text, truncated: result.finishReason === 'length' };
  } finally {
    await model.waitForIdle();
    requestContext.delete('model');
  }
}

export async function runWorkflow(id, operations, options, inputData) {
  const workflow = mastra.getWorkflow(id);
  const expected = definitions[id] ?? iterationDefinitions[id];
  if (!expected || expected.some((step) => typeof operations[step] !== 'function'))
    throw new Error('工作流缺少必要步骤。');
  options.signal?.throwIfAborted();
  const requestContext = new RequestContext();
  requestContext.set('execution', { operations, options });
  const run = await workflow.createRun({ disableScorers: true });
  // 业务 AbortSignal 控制模型与本地操作；结束前等待步骤退出，避免取消后后台继续写库。
  try {
    options.onRuntimeEvent?.({ type: 'workflow', id });
    const result = await run.start({ inputData, requestContext });
    options.signal?.throwIfAborted();
    if (requestContext.get('failure')) throw requestContext.get('failure');
    if (result.status !== 'success') throw new Error('工作流未完成，请重试；已有结果保留。');
    return result.result;
  } finally {
    requestContext.delete('execution');
    requestContext.delete('failure');
    workflow.runs.delete(run.runId);
  }
}

export async function runTool(id, input, execute, options) {
  if (!Object.hasOwn(toolSchemas, id)) throw new Error('未知的执行工具。');
  const parsed = toolSchemas[id].parse(input);
  const requestContext = new RequestContext();
  requestContext.set('execution', { execute, options });
  try {
    options.onRuntimeEvent?.({ type: 'tool', id });
    return await mastra.getTool(id).execute(parsed, { requestContext });
  } finally {
    requestContext.delete('execution');
  }
}
