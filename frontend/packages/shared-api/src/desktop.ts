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
  name: string;
  source: string;
  kind: string;
  characters: number;
  createdAt: string;
  updatedAt: string;
  analyzed: boolean;
}
export interface DocumentAnalysis {
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
export interface WorkspaceSnapshot {
  settings: PublicSettings;
  documents: DocumentSummary[];
  jobs: Record<string, AnalysisJob>;
  importing: boolean;
  feishu: FeishuStatus;
}
export interface DesktopBridge {
  snapshot(): Promise<WorkspaceSnapshot>;
  getDocument(id: string): Promise<WorkspaceDocument>;
  importFiles(): Promise<{ imported: string[]; errors: { name: string; message: string }[] }>;
  importFeishu(url: string): Promise<string>;
  deleteDocument(id: string): Promise<void>;
  analyze(id: string, goal: string): Promise<DocumentAnalysis>;
  cancelAnalysis(id: string): Promise<void>;
  saveSettings(input: SettingsInput): Promise<PublicSettings>;
  testModel(): Promise<string>;
  testFeishu(input: FeishuSettingsInput): Promise<FeishuStatus>;
  onChanged(callback: () => void): () => void;
}
