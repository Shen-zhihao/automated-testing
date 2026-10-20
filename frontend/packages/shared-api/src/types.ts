export interface ChatMessage {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatSession {
  readonly id: number;
  readonly title: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessage[];
}

export type TaskKind = 'ui' | 'api' | 'workflow';

export interface TestTask {
  readonly id: number;
  readonly name: string;
  readonly kind: TaskKind;
  readonly target: string;
  readonly status: 'draft';
  readonly createdAt: string;
}

export interface Skill {
  readonly id: number;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly instructions: string;
}

export interface PrototypeState {
  readonly sessions: readonly ChatSession[];
  readonly tasks: readonly TestTask[];
  readonly skills: readonly Skill[];
}

/** UI 原型的最小数据边界；后续接入真实服务时替换此实现。 */
export interface PrototypeClient {
  getSnapshot(): PrototypeState;
  subscribe(listener: () => void): () => void;
  createSession(): ChatSession;
  deleteSession(id: number): void;
  sendMessage(sessionId: number, content: string, skillIds: readonly number[]): void;
  createTask(input: { name: string; kind: TaskKind; target: string }): TestTask;
}
