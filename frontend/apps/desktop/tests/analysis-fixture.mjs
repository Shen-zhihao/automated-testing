// 仅用于本机联调与协议测试，不代表真实模型分析质量。
export function analysisReply(messages) {
  if (messages[0]?.content.includes('独立的工程范围与安全审查器')) return '{"decision":"allow"}';
  const prompt = messages[1]?.content ?? '';
  if (prompt.includes('连接测试')) return 'OK';
  if (prompt.includes('仅输出 JSON'))
    return JSON.stringify({
      scope: '账号登录与连续失败锁定；依据：原文分段。',
      features: [
        {
          name: '账号·连续失败锁定',
          requirements: '密码错误 5 次后锁定，保留原文边界。',
          dependencies: [],
          questions: ['锁定持续时间待确认。'],
        },
      ],
      questions: [],
    });
  const stepId = prompt.match(/S 编号从 (S-\d+-\d+)/)?.[1];
  if (stepId)
    return `1. **${stepId} 失败计数**：输入认证失败结果，第 5 次失败后锁定。依据：原文分段。持续时间待确认。`;
  const acId = prompt.match(/AC 编号从 (AC-\d+-\d+)/)?.[1];
  if (acId) {
    const allowed = prompt.match(/可引用的 S 编号：([^\n]+)/)?.[1] ?? prompt;
    const steps = [...new Set(allowed.match(/S-\d+-\d+/g) || [])];
    return `- **${acId}**：关联 ${steps.join('、')}；前置已有 4 次连续失败；操作：再输入错误密码；预期：账号进入锁定状态。依据：原文分段。状态：待验收。`;
  }
  return '原文分段的流程与状态依据：F-001 用户输入→校验→失败计数→锁定；失败恢复条件待确认。测试前置数据为已有 4 次失败，操作是再失败一次，可观察断言是进入锁定态；原型与真实接口分别验证，尚未执行。';
}

export const modelAnswer = (text, finish = 'stop', format = 'chat-completions') =>
  new Response(
    JSON.stringify(
      format === 'responses'
        ? {
            status: finish === 'length' ? 'incomplete' : 'completed',
            ...(finish === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
            output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
          }
        : { choices: [{ message: { content: text }, finish_reason: finish }] },
    ),
  );
