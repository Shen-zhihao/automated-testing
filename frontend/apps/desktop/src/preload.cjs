const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (name, ...args) => {
  const result = await ipcRenderer.invoke(`workspace:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const initialTheme = process.argv
  .find((value) => value.startsWith('--test-agent-appearance='))
  ?.split('=')[1]
  ?.split(':');
contextBridge.exposeInMainWorld('desktop', {
  initialAppearance:
    initialTheme &&
    ['system', 'light', 'dark'].includes(initialTheme[0]) &&
    ['light', 'dark'].includes(initialTheme[1])
      ? { mode: initialTheme[0], theme: initialTheme[1] }
      : null,
  getAppearance: () => invoke('appearance-get'),
  setAppearance: (mode) => invoke('appearance-set', mode),
  onAppearanceChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('workspace:appearance-changed', listener);
    return () => ipcRenderer.removeListener('workspace:appearance-changed', listener);
  },
  project: {
    terminalInfo: (id) => invoke('command-info', id),
    terminalRun: (id, runId) => invoke('command-get', id, runId),
    terminalRuns: (id) => invoke('command-list', id),
    setCommandMode: (id, mode) => invoke('command-mode', id, mode),
    proposeCommand: (id, input) => invoke('command-propose', id, input),
    approveCommand: (id, runId) => invoke('command-start', id, runId),
    rejectCommand: (id, runId) => invoke('command-reject', id, runId),
    stopCommand: (id) => invoke('command-stop', id),
    openCommandDirectory: (id) => invoke('command-directory', id),
    listFiles: (id) => invoke('project-files', id),
    cleanFiles: (id, input) => invoke('project-clean', id, input),
    clearCache: (id) => invoke('project-cache', id),
    deleteProject: (id, name) => invoke('project-delete', id, name),
    testingFeatures: (projectId, id) => invoke('testing-features', projectId, id),
    createChat: (projectId, input) => invoke('chat-create', projectId, input),
    getChat: (projectId, id) => invoke('chat-get', projectId, id),
    sendChat: (projectId, id, content) => invoke('chat-send', projectId, id, content),
    keepChatMessage: (projectId, id, messageId, taskId) =>
      invoke('chat-keep', projectId, id, messageId, taskId),
    createTestTask: (projectId, input) => invoke('testing-create', projectId, input),
    getTestTask: (projectId, id) => invoke('testing-get', projectId, id),
    updateTestTask: (projectId, id, input) => invoke('testing-update', projectId, id, input),
    generateTestDocument: (projectId, id) => invoke('testing-document', projectId, id),
    cancelTesting: (projectId, key) => invoke('testing-cancel', projectId, key),
    prepareTestPlan: (projectId, id, caseIds) => invoke('testing-plan', projectId, id, caseIds),
    runTestPlan: (projectId, id) => invoke('testing-run', projectId, id),
    exportTestDocument: (projectId, id) => invoke('testing-export', projectId, id),
    getDocument: (projectId, id) => invoke('document', projectId, id),
    importFiles: (projectId) => invoke('import-files', projectId),
    importFeishu: (projectId, url) => invoke('import-feishu', projectId, url),
    refreshDocument: (projectId, id) => invoke('refresh-document', projectId, id),
    deleteDocument: (projectId, id) => invoke('delete-document', projectId, id),
    analyze: (projectId, id, goal) => invoke('analyze', projectId, id, goal),
    exportAnalysis: (projectId, id) => invoke('export-analysis', projectId, id),
    cancelAnalysis: (projectId, id) => invoke('cancel', projectId, id),
    renameChat: (projectId, id, title) => invoke('chat-rename', projectId, id, title),
  },
  snapshot: (projectId) => invoke('snapshot', projectId),
  createProject: (input) => invoke('project-create', input),
  updateProject: (id, input) => invoke('project-update', id, input),
  openTestBrowser: (id, input) => invoke('testing-browser', id, input),
  getBrowserInfo: (id) => invoke('browser-info', id),
  attachBrowser: (id, bounds) => invoke('browser-attach', id, bounds),
  navigateBrowser: (id, action) => invoke('browser-navigate', id, action),
  getBrowserTabs: () => invoke('browser-tabs'),
  hideBrowserTab: (id) => invoke('browser-hide', id),
  loadBrowserUrl: (id, url) => invoke('browser-load', id, url),
  getBrowserData: () => invoke('browser-data'),
  importBrowserData: (kind) => invoke('browser-import', kind),
  removeBrowserData: (kind, id) => invoke('browser-data-remove', kind, id),
  fillBrowserPassword: (id, passwordId) => invoke('browser-password-fill', id, passwordId),
  saveSettings: (input) => invoke('save-settings', input),
  testModel: () => invoke('test-model'),
  testFeishu: (input) => invoke('test-feishu', input),
  selectStorageDirectory: () => invoke('select-storage'),
  relocateStorage: (directory) => invoke('relocate-storage', directory),
  openStorageDirectory: () => invoke('open-storage'),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },
  onBrowserChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('workspace:browser-changed', listener);
    return () => ipcRenderer.removeListener('workspace:browser-changed', listener);
  },
});
