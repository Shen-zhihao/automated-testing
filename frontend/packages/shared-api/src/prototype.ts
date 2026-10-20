import type { ChatSession, PrototypeClient, PrototypeState, Skill, TestTask } from './types';

const skillTemplates: readonly Skill[] = [
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

/** 所有数据仅存在于当前页面内存；不发请求、不读写浏览器存储。 */
export function createPrototypeClient(): PrototypeClient {
  let nextId = 1;
  let state: PrototypeState = { sessions: [], tasks: [], skills: skillTemplates };
  const listeners = new Set<() => void>();

  const update = (next: PrototypeState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    createSession: () => {
      const session: ChatSession = {
        id: nextId++,
        title: '新对话',
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      update({ ...state, sessions: [session, ...state.sessions] });
      return session;
    },
    deleteSession: (id) => {
      update({ ...state, sessions: state.sessions.filter((session) => session.id !== id) });
    },
    sendMessage: (sessionId, content, skillIds) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error('对话不存在，请新建对话。');
      const text = content.trim();
      if (!text) throw new Error('请输入测试目标。');
      const selected = state.skills.filter((skill) => skillIds.includes(skill.id));
      const skillNote = selected.length
        ? `\n\n本次选择的模板：${selected.map((skill) => skill.displayName).join('、')}。`
        : '';
      const updated: ChatSession = {
        ...session,
        title: session.messages.length ? session.title : text.slice(0, 24),
        updatedAt: new Date().toISOString(),
        messages: [
          ...session.messages,
          { id: nextId++, role: 'user', content: text },
          {
            id: nextId++,
            role: 'assistant',
            content: `已收到你的测试目标。\n\n这是**本地界面演示回复**，尚未接入模型、浏览器或测试执行器。你可以继续整理需求，或在「测试任务」中创建草稿。${skillNote}`,
          },
        ],
      };
      update({
        ...state,
        sessions: [updated, ...state.sessions.filter((item) => item.id !== sessionId)],
      });
    },
    createTask: ({ name, kind, target }) => {
      if (!name.trim()) throw new Error('请输入任务名称。');
      if (!['ui', 'api', 'workflow'].includes(kind)) throw new Error('未知任务类型。');
      const task: TestTask = {
        id: nextId++,
        name: name.trim(),
        kind,
        target: target.trim(),
        status: 'draft',
        createdAt: new Date().toISOString(),
      };
      update({ ...state, tasks: [task, ...state.tasks] });
      return task;
    },
  };
}

export const prototypeApi = createPrototypeClient();
