const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { saveApiKey, hasApiKey } = require('./ai/secureSettings');

let apiProcess = null;
let apiBaseUrl = null;
let mainWindow = null;
let scanSocket = null;

function resolveApiCommand() {
  // Dev: run the API project via `dotnet run`. Packaged builds should instead point at
  // the published self-contained exe bundled under process.resourcesPath.
  if (app.isPackaged) {
    return {
      command: path.join(process.resourcesPath, 'server', 'CheckScan.Api.exe'),
      args: [],
      cwd: path.join(process.resourcesPath, 'server'),
    };
  }
  const projectDir = path.join(__dirname, '..', 'server', 'CheckScan.Api');
  return {
    command: 'dotnet',
    args: ['run', '--no-launch-profile'],
    cwd: projectDir,
    // --no-launch-profile skips launchSettings.json, which is where ASPNETCORE_ENVIRONMENT
    // would normally get set to Development - without it the API defaults to Production and
    // never loads appsettings.Development.json (silently ignoring the real connection string).
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development' },
  };
}

function startApiProcess() {
  const { command, args, cwd, env } = resolveApiCommand();
  apiProcess = spawn(command, args, { cwd, env });

  return new Promise((resolve, reject) => {
    let resolved = false;

    apiProcess.stdout.on('data', (data) => {
      const text = data.toString();
      console.log(`[CheckScan.Api] ${text}`);
      const match = text.match(/PORT:(\d+)/);
      if (match && !resolved) {
        resolved = true;
        apiBaseUrl = `http://127.0.0.1:${match[1]}`;
        connectScanSocket(match[1]);
        resolve(apiBaseUrl);
      }
    });

    apiProcess.stderr.on('data', (data) => {
      console.error(`[CheckScan.Api] ${data.toString()}`);
    });

    apiProcess.on('exit', (code) => {
      console.log(`CheckScan.Api exited with code ${code}`);
      if (!resolved) reject(new Error(`API process exited before reporting a port (code ${code})`));
    });
  });
}

function connectScanSocket(port) {
  scanSocket = new WebSocket(`ws://127.0.0.1:${port}/ws/scan`);
  scanSocket.on('message', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('check-scanned', JSON.parse(data.toString()));
    }
  });
  scanSocket.on('error', (err) => console.error('[ws/scan]', err));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Resizable within a fixed band: never smaller than 1024x768, never larger than 1920x1080.
    minWidth: 1024,
    minHeight: 768,
    maxWidth: 1920,
    maxHeight: 1080,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    await startApiProcess();
  } catch (err) {
    console.error('Failed to start CheckScan.Api:', err);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (scanSocket) scanSocket.close();
  if (apiProcess) apiProcess.kill();
});

async function errorMessageFrom(res, fallback) {
  try {
    const body = await res.json();
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function getJson(pathAndQuery) {
  const res = await fetch(`${apiBaseUrl}${pathAndQuery}`);
  if (!res.ok) throw new Error(await errorMessageFrom(res, `Request to ${pathAndQuery} failed`));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function postJson(pathName, body) {
  const res = await fetch(`${apiBaseUrl}${pathName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFrom(res, `Request to ${pathName} failed`));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

ipcMain.handle('list-scanners', () => getJson('/scanners'));
ipcMain.handle('get-current-scanner', () => getJson('/scanners/current'));
ipcMain.handle('select-scanner', (_event, { sourceId, sourceName }) =>
  postJson('/scanners/select', { sourceId, sourceName }));

ipcMain.handle('start-scan', async () => {
  // Empty body: the API auto-selects ADF batch vs single flatbed from the scanner's capabilities.
  const res = await fetch(`${apiBaseUrl}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(await errorMessageFrom(res, 'Failed to start scan'));
  return true;
});

ipcMain.handle('get-feeder-status', () => getJson('/scan/feeder-status'));

// Extraction runs server-side now: the API calls Anthropic with the key from its
// Anthropic:ApiKey config (see server AI/CheckExtractionService.cs).
ipcMain.handle('extract-check', (_event, imagePath) => postJson('/checks/extract', { imagePath }));

// Returns a scanned check JPEG as a data URL so the review panel can display it. The images
// live on local disk until the check is saved; returns null if the file can't be read.
ipcMain.handle('get-check-image', (_event, imagePath) => {
  try {
    const buf = fs.readFileSync(imagePath);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('[get-check-image]', err.message);
    return null;
  }
});

ipcMain.handle('create-batch', (_event, label) => postJson('/batches', { label: label ?? null }));

ipcMain.handle('list-fundraisers', () => getJson('/fundraisers'));
ipcMain.handle('create-fundraiser', (_event, name) => postJson('/fundraisers', { name }));
ipcMain.handle('get-fundraiser', (_event, id) => getJson(`/fundraisers/${id}`));

ipcMain.handle('save-check', (_event, check) => postJson('/checks', check));

ipcMain.handle('get-reports-summary', (_event, { groupBy, from, to }) => {
  const params = new URLSearchParams({ groupBy });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return getJson(`/reports/summary?${params.toString()}`);
});

// Writes a caller-supplied CSV string to a user-chosen file (used by the fundraiser
// detail page's "Export to CSV"). Returns { saved, filePath }.
ipcMain.handle('save-csv-file', async (_event, { defaultName, csv }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to CSV',
    defaultPath: defaultName || 'export.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, csv);
  return { saved: true, filePath };
});

ipcMain.handle('export-reports-csv', async (_event, { groupBy, from, to }) => {
  const params = new URLSearchParams({ groupBy });
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const res = await fetch(`${apiBaseUrl}/reports/export?${params.toString()}`);
  if (!res.ok) throw new Error(await errorMessageFrom(res, 'Failed to export report'));
  const csvText = await res.text();

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Report',
    defaultPath: `checkscan-report-${groupBy}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { saved: false };

  fs.writeFileSync(filePath, csvText);
  return { saved: true, filePath };
});

ipcMain.handle('save-ai-key', (_event, key) => {
  saveApiKey(key);
  return true;
});

ipcMain.handle('get-ai-key-status', () => hasApiKey());

// Azure SQL + Azure Blob connection strings: entered here, stored DPAPI-encrypted by the API
// (see server Storage/SecretStore.cs). Status returns booleans only, never the values.
ipcMain.handle('get-settings-status', () => getJson('/settings/status'));
ipcMain.handle('save-db-connection', (_event, connectionString) =>
  postJson('/settings/db-connection', { connectionString }));
ipcMain.handle('save-blob-connection', (_event, connectionString) =>
  postJson('/settings/blob-connection', { connectionString }));
