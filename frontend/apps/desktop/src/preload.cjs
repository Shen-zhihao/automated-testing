const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (name, ...args) => {
  const result = await ipcRenderer.invoke(`workspace:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld('desktop', {
  snapshot: () => invoke('snapshot'),
  getDocument: (id) => invoke('document', id),
  importFiles: () => invoke('import-files'),
  importFeishu: (url) => invoke('import-feishu', url),
  deleteDocument: (id) => invoke('delete-document', id),
  analyze: (id, goal) => invoke('analyze', id, goal),
  cancelAnalysis: (id) => invoke('cancel', id),
  saveSettings: (input) => invoke('save-settings', input),
  testModel: () => invoke('test-model'),
  testFeishu: (input) => invoke('test-feishu', input),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },
});
