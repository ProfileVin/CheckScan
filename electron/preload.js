const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('checkScan', {
  listScanners: () => ipcRenderer.invoke('list-scanners'),
  getCurrentScanner: () => ipcRenderer.invoke('get-current-scanner'),
  selectScanner: (sourceId, sourceName) => ipcRenderer.invoke('select-scanner', { sourceId, sourceName }),
  startScan: () => ipcRenderer.invoke('start-scan'),
  getFeederStatus: () => ipcRenderer.invoke('get-feeder-status'),
  testScanner: () => ipcRenderer.invoke('test-scanner'),
  extractCheck: (imagePath) => ipcRenderer.invoke('extract-check', imagePath),
  getCheckImage: (imagePath) => ipcRenderer.invoke('get-check-image', imagePath),
  onCheckScanned: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('check-scanned', listener);
    return () => ipcRenderer.removeListener('check-scanned', listener);
  },

  createBatch: (label) => ipcRenderer.invoke('create-batch', label),

  listFundraisers: () => ipcRenderer.invoke('list-fundraisers'),
  createFundraiser: (name) => ipcRenderer.invoke('create-fundraiser', name),
  getFundraiser: (id) => ipcRenderer.invoke('get-fundraiser', id),

  saveCheck: (check) => ipcRenderer.invoke('save-check', check),

  getReportsSummary: (groupBy, from, to) => ipcRenderer.invoke('get-reports-summary', { groupBy, from, to }),
  getReportTransactions: () => ipcRenderer.invoke('get-report-transactions'),
  exportReportsCsv: (groupBy, from, to) => ipcRenderer.invoke('export-reports-csv', { groupBy, from, to }),
  saveCsvFile: (defaultName, csv) => ipcRenderer.invoke('save-csv-file', { defaultName, csv }),

  saveAiKey: (key) => ipcRenderer.invoke('save-ai-key', key),
  getAiKeyStatus: () => ipcRenderer.invoke('get-ai-key-status'),

  getSettingsStatus: () => ipcRenderer.invoke('get-settings-status'),
  saveDbConnection: (connectionString) => ipcRenderer.invoke('save-db-connection', connectionString),
  saveBlobConnection: (connectionString) => ipcRenderer.invoke('save-blob-connection', connectionString),
});
