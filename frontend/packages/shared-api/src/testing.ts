export interface RequirementFeature {
  id: string;
  title: string;
}
export interface RequirementReference {
  projectId: string;
  id: string;
  documentId: string;
  name: string;
  analysisCreatedAt: string;
  features: RequirementFeature[];
  changed: boolean;
  warnings?: string[];
}
export interface WorkChatMessage {
  contextUsage?: ChatContextUsage;
  commandIds?: string[];
  refused?: boolean;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'complete' | 'error';
  excerpts?: { id: string; text: string }[];
  references?: RequirementReference[];
}
export interface ChatContextUsage {
  recentTurns: number;
  recalledTurns: number;
  omittedTurns: number;
  documents: number;
  sourceExcerpts: number;
  historyCompacted: boolean;
  referenceChanged: boolean;
}
export interface WorkChatSummary {
  projectId: string;
  id: string;
  title: string;
  sourceId: string | null;
  featureId: string;
  taskId: string | null;
  updatedAt: string;
}
export interface WorkChat extends WorkChatSummary {
  source: RequirementReference | null;
  messages: WorkChatMessage[];
}
export interface TaskNote {
  id: string;
  sessionId: string;
  messageId: string;
  content: string;
  createdAt: string;
}
export interface DetailedTestCase {
  id: string;
  title: string;
  requirement: string;
  priority: 'P0' | 'P1' | 'P2';
  preconditions: string[];
  steps: string[];
  expected: string[];
  automation: string;
}
export interface DetailedTestDocument {
  id: string;
  revision: number;
  createdAt: string;
  model: string;
  markdown: string;
  scope: string;
  environment: string;
  strategy: string;
  risks: string;
  questions: string;
  cases: DetailedTestCase[];
}
export interface BrowserStep {
  action:
    | 'goto'
    | 'click'
    | 'fill'
    | 'select'
    | 'check'
    | 'assertText'
    | 'assertUrl'
    | 'assertVisible'
    | 'wait';
  description: string;
  locator?: { by: 'css' | 'text' | 'label' | 'placeholder'; value: string };
  value?: string;
  milliseconds?: number;
  expectedIndex?: number;
}
export interface BrowserCasePlan {
  caseId: string;
  manualReason: string;
  steps: BrowserStep[];
}
export interface BrowserTestPlan {
  id: string;
  reportId: string;
  revision: number;
  createdAt: string;
  startUrl: string;
  cases: BrowserCasePlan[];
}
export interface BrowserStepResult {
  index: number;
  description: string;
  action: string;
  expectedIndex?: number;
  status: 'passed' | 'failed';
  evidence: string;
  createdAt: string;
}
export interface BrowserRun {
  id: string;
  taskId: string;
  reportId: string;
  status: 'running' | 'passed' | 'failed' | 'partial' | 'cancelled';
  createdAt: string;
  finishedAt: string | null;
  url: string;
  message: string;
  untestedCaseIds: string[];
  steps: (BrowserStepResult & { caseId: string })[];
  cases: {
    caseId: string;
    status: 'passed' | 'failed' | 'manual' | 'skipped' | 'running';
    message: string;
    steps: BrowserStepResult[];
  }[];
}
export interface WorkTestTaskSummary {
  caseCount: number;
  lastRunStatus: BrowserRun['status'] | null;
  projectId: string;
  id: string;
  name: string;
  scope: string;
  sourceId: string;
  documentName: string;
  updatedAt: string;
  hasReport: boolean;
  reportStale: boolean;
  noteCount: number;
  url: string;
}
export interface WorkTestTask {
  projectId: string;
  id: string;
  name: string;
  scope: string;
  sourceId: string;
  featureId: string;
  sessionId: string | null;
  source: RequirementReference;
  updatedAt: string;
  revision: number;
  url: string;
  notes: TaskNote[];
  report: DetailedTestDocument | null;
  reportHistory: DetailedTestDocument[];
  reportStale: boolean;
  documentDraft?: TestGenerationProgress | null;
  planDraft?: TestGenerationProgress | null;
  plan: BrowserTestPlan | null;
  runs: BrowserRun[];
  browserOpen: boolean;
}
export interface TestGenerationProgress {
  completed: number;
  total: number;
  caseIds?: string[];
}
export interface TestingJob {
  revision?: number;
  status: 'running' | 'complete' | 'cancelled' | 'error';
  kind: 'chat' | 'document' | 'browser' | 'plan' | 'run';
  message: string;
}
export interface CreateWorkInput {
  documentId?: string;
  sessionId?: string;
  taskId?: string;
  featureId?: string;
  name?: string;
  scope?: string;
}
export interface BrowserOpenInput {
  projectId?: string;
  url?: string;
}
export interface BrowserInfo {
  title: string;
  loading: boolean;
  error: string;
  open: boolean;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabInfo extends BrowserInfo {
  projectId: string | null;
  id: string;
  parentId: string | null;
}
export type BrowserImportKind = 'bookmarks' | 'passwords';
export interface BrowserImportResult {
  kind: BrowserImportKind;
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
}
export interface BrowserSavedData {
  bookmarks: { id: string; title: string; url: string; folder: string }[];
  passwords: { id: string; origin: string; usernameLabel: string }[];
}
