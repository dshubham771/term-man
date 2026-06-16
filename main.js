const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const { getPtySpawnOptions, isZsh } = require('./lib/pty-spawn');
const { getResourcePath, isUsableShellResource } = require('./lib/resource-path');
const { PtyOutputFilter } = require('./lib/pty-output-filter');
const { CommandHistoryStore } = require('./command-history-store');

// Store active PTY processes
const ptyProcesses = new Map();
/** @type {Map<string, PtyOutputFilter>} */
const ptyOutputFilters = new Map();
const commandHistoryStore = new CommandHistoryStore();

function getShellIntegrationPaths() {
  const zdotdir = getResourcePath(
    __dirname,
    app.isPackaged,
    process.resourcesPath,
    'shell',
    'zdotdir',
  );
  const integration = getResourcePath(
    __dirname,
    app.isPackaged,
    process.resourcesPath,
    'shell',
    'tm-zsh-integration.zsh',
  );

  try {
    if (!fs.existsSync(zdotdir) || !fs.statSync(zdotdir).isDirectory()) {
      return null;
    }
    if (!isUsableShellResource(integration)) {
      return null;
    }
  } catch {
    return null;
  }

  return { zdotdir, integration };
}

function buildPtySpawnOptions(shell) {
  const integrationPaths = getShellIntegrationPaths();
  return getPtySpawnOptions(
    shell,
    integrationPaths || { zdotdir: '', integration: '' },
    process.env,
  );
}

function isShellIntegrationEnabled(shell) {
  return isZsh(shell) && getShellIntegrationPaths() !== null;
}

function broadcastToRenderer(channel, payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function handlePtyOutput(id, chunk) {
  let filter = ptyOutputFilters.get(id);
  if (!filter) {
    filter = new PtyOutputFilter();
    ptyOutputFilters.set(id, filter);
  }

  const { output, commands, prompt } = filter.process(chunk);

  if (commands.length > 0) {
    for (const command of commands) {
      commandHistoryStore.add(command);
    }
    broadcastToRenderer('commandHistory:updated', {
      entries: commandHistoryStore.getEntries(),
    });
  }

  if (prompt) {
    broadcastToRenderer('pty:meta', { id, atPrompt: true });
  }

  if (filter.alternateScreen !== filter._lastAlternateScreen) {
    filter._lastAlternateScreen = filter.alternateScreen;
    broadcastToRenderer('pty:meta', {
      id,
      alternateScreen: filter.alternateScreen,
    });
  }

  if (output) {
    broadcastToRenderer('pty:data', { id, data: output });
  }
}

// ─── State Persistence ────────────────────────────────────
const STATE_DIR = path.join(os.homedir(), '.terminal-manager');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SESSIONS_DIR = path.join(STATE_DIR, 'sessions');

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

// Detect user's default shell
function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  setupWindowQuitSave(mainWindow);

  mainWindow.on('closed', () => {
    for (const [id, ptyProc] of ptyProcesses) {
      try {
        ptyProc.kill();
      } catch (e) {}
    }
    ptyProcesses.clear();
  });
}

function setupWindowQuitSave(mainWindow) {
  mainWindow._allowClose = false;
  mainWindow._quitSaveTimeout = null;

  mainWindow.on('close', (e) => {
    if (mainWindow._allowClose) return;
    e.preventDefault();
    mainWindow.webContents.send('app:before-quit');
    mainWindow._quitSaveTimeout = setTimeout(() => {
      mainWindow._allowClose = true;
      if (!mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    }, 4000);
  });
}

ipcMain.on('state:saveComplete', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  if (win._quitSaveTimeout) {
    clearTimeout(win._quitSaveTimeout);
    win._quitSaveTimeout = null;
  }
  win._allowClose = true;
  win.close();
});

ipcMain.handle('pty:create', (event, { id, cwd }) => {
  const shell = getDefaultShell();
  const defaultCwd = cwd || os.homedir();
  const { shell: spawnShell, args, env } = buildPtySpawnOptions(shell);

  try {
    const ptyProcess = pty.spawn(spawnShell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: defaultCwd,
      env,
    });

    ptyProcesses.set(id, ptyProcess);
    ptyOutputFilters.set(id, new PtyOutputFilter());

    ptyProcess.onData((data) => {
      handlePtyOutput(id, data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      ptyProcesses.delete(id);
      ptyOutputFilters.delete(id);
      broadcastToRenderer('pty:exit', { id, exitCode, signal });
    });

    return { success: true, pid: ptyProcess.pid, shellIntegration: isShellIntegrationEnabled(shell) };
  } catch (error) {
    console.error(`Failed to create PTY for ${id}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pty:write', (event, { id, data }) => {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    ptyProcess.write(data);
    return true;
  }
  return false;
});

ipcMain.handle('pty:resize', (event, { id, cols, rows }) => {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    try {
      ptyProcess.resize(cols, rows);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
});

ipcMain.handle('pty:kill', (event, { id }) => {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {}
    ptyProcesses.delete(id);
    ptyOutputFilters.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle('commandHistory:get', () => commandHistoryStore.getEntries());

// Open native folder picker dialog
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Folder',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// Save state to disk
ipcMain.handle('state:save', (event, stateData) => {
  try {
    ensureStateDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateData, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to save state:', error);
    return false;
  }
});

// Load state from disk
ipcMain.handle('state:load', () => {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load state:', error);
  }
  return null;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  for (const [id, ptyProc] of ptyProcesses) {
    try {
      ptyProc.kill();
    } catch (e) {}
  }
  ptyProcesses.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
