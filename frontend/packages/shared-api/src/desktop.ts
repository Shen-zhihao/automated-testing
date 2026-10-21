import type {
  RequirementFeature,
  WorkChat,
  WorkChatSummary,
  WorkTestTask,
  WorkTestTaskSummary,
  TestingJob,
  CreateWorkInput,
  BrowserOpenInput,
  BrowserTabInfo,
  BrowserInfo,
  BrowserBounds,
  BrowserImportKind,
  BrowserImportResult,
  BrowserSavedData,
} from './testing';
export interface ModelSettings {
  baseUrl: string;
  model: string;
  format: 'chat-completions' | 'responses';
  tokenParameter: 'max_tokens' | 'max_completion_tokens';
  maxTokens: number;
  temperature: number | null;
  timeoutSeconds: number;
}

export interface PublicSettings {
  model: ModelSettings;
  hasApiKey: boolean;
}
export interface SettingsInput {
  model: ModelSettings;
  apiKey: string;
  clearApiKey: boolean;
}
export interface DocumentSummary {
  id: string;
  projectId: string;
  name: string;
  source: string;
  kind: string;
  characters: number;
  createdAt: string;
  updatedAt: string;
  analyzed: boolean;
}
export interface DocumentAnalysis {
  kind?: 'implementation-plan';
  content: string;
  goal: string;
  model: string;
  baseUrl: string;
  createdAt: string;
  segments: number;
}
export interface WorkspaceDocument extends Omit<DocumentSummary, 'characters' | 'analyzed'> {
  content: string;
  warnings: string[];
  analysis: DocumentAnalysis | null;
  preview: { format: 'html' | 'markdown' | 'text'; content: string } | null;
}
export interface FeishuStatus {
  configured: boolean;
  appId: string;
  hasAppSecret: boolean;
  connected: boolean;
  testing: boolean;
}
export interface FeishuSettingsInput {
  appId: string;
  appSecret: string;
}
export interface AnalysisJob {
  status: 'running' | 'complete' | 'cancelled' | 'error';
  message: string;
}
export interface ProjectInput {
  name: string;
  description: string;
}
export interface WorkspaceProject extends ProjectInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectSummary extends WorkspaceProject {
  documentCount: number;
  analyzedCount: number;
  chatCount: number;
  taskCount: number;
}
export interface WorkspaceSnapshot {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  testSessions: WorkChatSummary[];
  testTasks: WorkTestTaskSummary[];
  testJobs: Record<string, TestingJob>;
  settings: PublicSettings;
  documents: DocumentSummary[];
  jobs: Record<string, AnalysisJob>;
  importing: boolean;
  feishu: FeishuStatus;
  storage: StorageInfo;
}
export interface StorageInfo {
  directory: string;
  databasePath: string;
  defaultDirectory: string;
  migrating: boolean;
}
export interface ProjectFilesInfo {
  exports: {
    id: string;
    name: string;
    path: string;
    status: 'saved' | 'changed' | 'missing';
    bytes: number;
    createdAt: string;
  }[];
  cacheBytes: number;
  documentBytes: number;
  commandDirectory?: string;
  commandBytes?: number;
}
export interface ProjectCleanInput {
  cleanCommands?: boolean;
  documentIds?: string[];
  exportIds?: string[];
  detach?: boolean;
}
export type CommandMode = 'manual' | 'managed';
export interface TerminalInfo {
  mode: CommandMode;
  shell: string;
  directory: string;
  platform: string;
}
export interface CommandRun {
  id: string;
  projectId: string;
  sessionId: string | null;
  command: string;
  reason: string;
  cwd: string;
  shell: string;
  status:
    | 'reviewing'
    | 'pending'
    | 'running'
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'rejected'
    | 'cancelled'
    | 'timed-out'
    | 'interrupted';
  output: string;
  truncated: boolean;
  error: string;
  exitCode: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  approval?: CommandMode;
}
export interface ProjectBridge {
  terminalInfo(): Promise<TerminalInfo>;
  terminalRuns(): Promise<CommandRun[]>;
  terminalRun(id: string): Promise<CommandRun>;
  setCommandMode(mode: CommandMode): Promise<TerminalInfo>;
  proposeCommand(input: {
    command: string;
    reason: string;
    sessionId?: string;
  }): Promise<CommandRun>;
  approveCommand(id: string): Promise<void>;
  rejectCommand(id: string): Promise<void>;
  stopCommand(): Promise<void>;
  openCommandDirectory(): Promise<void>;
  listFiles(): Promise<ProjectFilesInfo>;
  cleanFiles(input: ProjectCleanInput): Promise<void>;
  clearCache(): Promise<void>;
  deleteProject(name: string): Promise<void>;
  testingFeatures(id: string): Promise<RequirementFeature[]>;
  createChat(input: CreateWorkInput): Promise<WorkChat>;
  getChat(id: string): Promise<WorkChat>;
  sendChat(id: string, content: string): Promise<WorkChat>;
  keepChatMessage(id: string, messageId: string, taskId?: string): Promise<WorkTestTask>;
  createTestTask(input: CreateWorkInput): Promise<WorkTestTask>;
  getTestTask(id: string): Promise<WorkTestTask>;
  updateTestTask(
    id: string,
    input: { name: string; scope: string; url: string },
  ): Promise<WorkTestTask>;
  generateTestDocument(id: string): Promise<WorkTestTask>;
  cancelTesting(key: string): Promise<void>;
  prepareTestPlan(id: string, caseIds: string[]): Promise<WorkTestTask>;
  runTestPlan(id: string): Promise<WorkTestTask>;
  exportTestDocument(id: string): Promise<string | null>;
  getDocument(id: string): Promise<WorkspaceDocument>;
  importFiles(): Promise<{ imported: string[]; errors: { name: string; message: string }[] }>;
  importFeishu(url: string): Promise<string>;
  refreshDocument(id: string): Promise<{ document: WorkspaceDocument; contentChanged: boolean }>;
  deleteDocument(id: string): Promise<void>;
  analyze(id: string, goal: string): Promise<DocumentAnalysis>;
  exportAnalysis(id: string): Promise<string | null>;
  cancelAnalysis(id: string): Promise<void>;
  renameChat(id: string, title: string): Promise<WorkChat>;
}

export type ScopedProjectBridge = {
  [K in keyof ProjectBridge]: (
    projectId: string,
    ...args: Parameters<ProjectBridge[K]>
  ) => ReturnType<ProjectBridge[K]>;
};

export type AppearanceMode = 'system' | 'light' | 'dark';
export interface AppearanceState {
  mode: AppearanceMode;
  theme: 'light' | 'dark';
}
export interface DesktopBridge {
  initialAppearance: AppearanceState | null;
  getAppearance(): Promise<AppearanceState>;
  setAppearance(mode: AppearanceMode): Promise<AppearanceState>;
  onAppearanceChanged(callback: () => void): () => void;
  project: ScopedProjectBridge;
  createProject(input: ProjectInput): Promise<WorkspaceProject>;
  updateProject(id: string, input: ProjectInput): Promise<WorkspaceProject>;
  openTestBrowser(id: string, input?: BrowserOpenInput): Promise<string>;
  getBrowserInfo(id: string): Promise<BrowserInfo>;
  attachBrowser(id: string, bounds: BrowserBounds | null): Promise<void>;
  navigateBrowser(id: string, action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void>;
  getBrowserTabs(): Promise<BrowserTabInfo[]>;
  hideBrowserTab(id: string): Promise<void>;
  loadBrowserUrl(id: string, url: string): Promise<void>;
  getBrowserData(): Promise<BrowserSavedData>;
  importBrowserData(kind: BrowserImportKind): Promise<BrowserImportResult | null>;
  removeBrowserData(kind: BrowserImportKind, id: string): Promise<void>;
  fillBrowserPassword(id: string, passwordId: string): Promise<void>;
  snapshot(projectId?: string): Promise<WorkspaceSnapshot>;
  saveSettings(input: SettingsInput): Promise<PublicSettings>;
  testModel(): Promise<string>;
  testFeishu(input: FeishuSettingsInput): Promise<FeishuStatus>;
  selectStorageDirectory(): Promise<string | null>;
  relocateStorage(directory: string): Promise<StorageInfo>;
  openStorageDirectory(): Promise<void>;
  onChanged(callback: () => void): () => void;
  onBrowserChanged(callback: () => void): () => void;
}
