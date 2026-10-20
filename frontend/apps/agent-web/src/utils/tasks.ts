import type { TaskKind } from '@project/shared-api';

export const taskKindLabels: Record<TaskKind, string> = {
  ui: '页面测试',
  api: '接口测试',
  workflow: '流程测试',
};
