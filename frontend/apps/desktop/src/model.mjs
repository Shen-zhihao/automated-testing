import { reviewScope, explicitBypass, SCOPE_REFUSAL, SAFETY_REFUSAL } from './agent-policy.mjs';
import { complete } from './model-client.mjs';
import { generateImplementationPlan } from './analysis.mjs';
import { runWorkflow } from './mastra/runtime.mjs';
export { complete } from './model-client.mjs';
export { splitText } from './analysis-text.mjs';

export function reviewAgentScope(config, context, options = {}) {
  return reviewScope(
    // 推理 Token 也可能计入输出额度，不能把短 JSON 审查固定压到 1024。
    (messages) =>
      complete(config, messages, { ...options, maxTokens: config.maxTokens, agentId: 'reviewer' }),
    context,
  );
}

export function validateAnalysisGoal(goal) {
  if (typeof goal !== 'string' || goal.length > 4000)
    throw new Error('分析重点请限制在 4000 字符以内。');
  if (explicitBypass(goal)) throw new Error(SAFETY_REFUSAL);
  return goal.trim();
}

export async function analyzeDocument(document, goal, config, options = {}) {
  const { signal, fetchImpl } = options;
  goal = validateAnalysisGoal(goal);
  return runWorkflow(
    'document-analysis',
    {
      'review-scope': async () => {
        const decision = await reviewAgentScope(
          config,
          {
            kind: 'request',
            project: document.name,
            source: document.content.slice(0, 10000),
            request: goal || '分析本工程需求的功能实现步骤和验收标准',
          },
          { ...options, signal, fetchImpl, reasoningEffort: 'none' },
        );
        if (decision !== 'allow')
          throw new Error(decision === 'unsafe' ? SAFETY_REFUSAL : SCOPE_REFUSAL);
        return { decision };
      },
      'generate-report': () => generateImplementationPlan(document, goal, config, options),
    },
    options,
  );
}
