import type { Skill } from './types';

export const skillTemplates: readonly Skill[] = [
  {
    id: 1,
    name: 'test-case-design',
    displayName: '测试用例设计',
    description: '用于预览技能选择与详情界面的示例模板，尚未接入执行。',
    version: '0.1.0',
    instructions:
      '### 测试用例设计模板\n\n后续可在这里补充输入要求、测试步骤和预期结果。\n\n当前仅供界面预览，不会生成或执行真实用例。',
  },
  {
    id: 2,
    name: 'test-result-summary',
    displayName: '测试结果整理',
    description: '预留结果整理能力的位置，尚未连接报告或执行器。',
    version: '0.1.0',
    instructions:
      '### 测试结果整理模板\n\n后续可在这里定义日志、截图和断言结果的整理方式。\n\n当前没有真实测试数据，也不会生成通过率或执行结论。',
  },
];
