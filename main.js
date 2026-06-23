const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execFile, execSync } = require('child_process');
const pty = require('node-pty');
const { getGitStatus, getFileDiff } = require('./git-service');
const { CommandHistoryStore } = require('./command-history-store');
const { PtyOutputFilter } = require('./lib/pty-output-filter');
const { getPtySpawnOptions, isZsh } = require('./lib/pty-spawn');
const { getResourcePath, isUsableShellResource } = require('./lib/resource-path');

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

const FILE_TREE_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'target',
  '.turbo',
  '.cache',
]);

const FILE_TREE_IGNORE_FILES = new Set(['.DS_Store']);

function runGitCommand(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 1 && args[0] === 'diff') {
          resolve(stdout);
          return;
        }
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function isGitRepo(cwd) {
  try {
    await runGitCommand(cwd, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

async function listGitProjectFiles(cwd) {
  const output = await runGitCommand(cwd, ['ls-files', '--cached', '--others', '--exclude-standard']);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function listFilesystemFiles(rootDir) {
  const results = [];

  async function walk(currentDir, relativeDir = '') {
    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      console.error(`Failed to read directory "${currentDir}":`, error);
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const normalizedPath = relativePath.split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (FILE_TREE_IGNORE_DIRS.has(entry.name)) continue;
        await walk(fullPath, relativePath);
        continue;
      }

      if (entry.isFile()) {
        if (FILE_TREE_IGNORE_FILES.has(entry.name)) continue;
        results.push(normalizedPath);
      }
    }
  }

  await walk(rootDir);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

async function listProjectFiles(cwd) {
  if (await isGitRepo(cwd)) {
    return {
      isRepo: true,
      files: await listGitProjectFiles(cwd),
    };
  }

  return {
    isRepo: false,
    files: await listFilesystemFiles(cwd),
  };
}

function resolveProjectFilePath(cwd, filePath) {
  const root = path.resolve(cwd);
  const absolutePath = path.resolve(root, filePath);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid file path');
  }

  return absolutePath;
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
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  setupWindowQuitSave(mainWindow);

  // Clean up all PTY processes when window is closed
  mainWindow.on('closed', () => {
    for (const [id, ptyProc] of ptyProcesses) {
      try {
        ptyProc.kill();
      } catch (e) {
        // Process may already be dead
      }
    }
    ptyProcesses.clear();
  });
}

// ─── IPC Handlers ─────────────────────────────────────────

// Create a new PTY process
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

// Write data to a PTY process
ipcMain.handle('pty:write', (event, { id, data }) => {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    ptyProcess.write(data);
    return true;
  }
  return false;
});

// Resize a PTY process
ipcMain.handle('pty:resize', (event, { id, cols, rows }) => {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    try {
      ptyProcess.resize(cols, rows);
      return true;
    } catch (e) {
      // Process may have exited
      return false;
    }
  }
  return false;
});

// Kill a PTY process
ipcMain.handle('pty:kill', (event, { id }) => {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {
      // Process may already be dead
    }
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

// ─── Window quit / state flush ─────────────────────────────

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

// ─── State Persistence IPC ────────────────────────────────

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

// ─── Git IPC Handlers ─────────────────────────────────────

// Get git status for a folder
ipcMain.handle('git:status', async (event, { cwd }) => {
  try {
    return await getGitStatus(cwd);
  } catch (error) {
    console.error('Failed to get git status:', error);
    return { branch: null, files: [], isRepo: false };
  }
});

// Get diff data for a file
ipcMain.handle('git:diff', async (event, { cwd, filePath, fileStatus }) => {
  try {
    return await getFileDiff(cwd, filePath, fileStatus);
  } catch (error) {
    console.error('Failed to get diff:', error);
    return { original: '', modified: '', language: 'plaintext', filePath };
  }
});

ipcMain.handle('project:listFiles', async (event, { cwd }) => {
  try {
    return await listProjectFiles(cwd);
  } catch (error) {
    console.error('Failed to list project files:', error);
    return { isRepo: false, files: [] };
  }
});

ipcMain.handle('project:readFile', async (event, { cwd, filePath }) => {
  try {
    const absolutePath = resolveProjectFilePath(cwd, filePath);
    const content = await fs.promises.readFile(absolutePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    console.error('Failed to read project file:', error);
    return { success: false, error: error.message, content: '' };
  }
});

// ─── Claude Code Monitoring ────────────────────────────────

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
let claudeSettingsWatcher = null;

function readClaudeSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to read claude settings:', e);
  }
  return {};
}

ipcMain.handle('claude:getStatus', () => {
  const settings = readClaudeSettings();
  return { model: settings.model || null };
});

ipcMain.handle('claude:setModel', (event, { model }) => {
  try {
    const settings = readClaudeSettings();
    settings.model = model;
    const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    console.error('Failed to set claude model:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('claude:startWatching', () => {
  if (claudeSettingsWatcher || !fs.existsSync(CLAUDE_SETTINGS_PATH)) return;
  try {
    claudeSettingsWatcher = fs.watch(CLAUDE_SETTINGS_PATH, { persistent: false }, (eventType) => {
      if (eventType !== 'change') return;
      // Small delay to let the write fully flush before reading
      setTimeout(() => {
        const settings = readClaudeSettings();
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('claude:settingsChanged', settings);
        }
      }, 120);
    });
  } catch (e) {
    console.error('Failed to watch claude settings:', e);
  }
});

ipcMain.handle('claude:isRunning', () => {
  return new Promise((resolve) => {
    // Try exact process name first, then fall back to path match
    exec('pgrep -x claude 2>/dev/null || pgrep -f "/claude" 2>/dev/null | head -1', (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
});

ipcMain.handle('claude:sendToTerminal', (event, { id, command }) => {
  const ptyProcess = ptyProcesses.get(id);
  if (ptyProcess) {
    ptyProcess.write(command + '\r');
    return true;
  }
  return false;
});

// ─── Claude Code session detection ─────────────────────────

const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
let claudeSessionsWatcher = null;
let claudeSessionsNotifyTimer = null;

function listProcesses() {
  const output = execSync('ps -eo pid=,ppid=,comm=', {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const processes = [];
  for (const line of output.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    processes.push({
      pid: parseInt(match[1], 10),
      ppid: parseInt(match[2], 10),
      comm: match[3].trim(),
    });
  }
  return processes;
}

function readClaudeSessionFile(pid) {
  const filePath = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!data.sessionId) return null;
    return {
      sessionId: data.sessionId,
      name: data.name || null,
      cwd: data.cwd || null,
      updatedAt: data.updatedAt || null,
    };
  } catch (e) {
    console.error(`Failed to read Claude session file for pid ${pid}:`, e);
    return null;
  }
}

function resolveClaudeSessionForShellPid(shellPid) {
  if (!shellPid || !Number.isFinite(shellPid)) return null;

  const processes = listProcesses();
  const childrenByPpid = new Map();
  for (const proc of processes) {
    if (!childrenByPpid.has(proc.ppid)) {
      childrenByPpid.set(proc.ppid, []);
    }
    childrenByPpid.get(proc.ppid).push(proc);
  }

  const queue = [shellPid];
  const visited = new Set();
  let best = null;

  while (queue.length > 0) {
    const pid = queue.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);

    const children = childrenByPpid.get(pid) || [];
    for (const child of children) {
      const commBase = path.basename(child.comm);
      if (commBase === 'claude') {
        const session = readClaudeSessionFile(child.pid);
        if (session) {
          const updatedAt = session.updatedAt || 0;
          if (!best || updatedAt >= (best.updatedAt || 0)) {
            best = session;
          }
        }
      }
      queue.push(child.pid);
    }
  }

  return best;
}

function notifyClaudeSessionsUpdated() {
  if (claudeSessionsNotifyTimer) clearTimeout(claudeSessionsNotifyTimer);
  claudeSessionsNotifyTimer = setTimeout(() => {
    claudeSessionsNotifyTimer = null;
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('claude:sessionUpdated');
    }
  }, 200);
}

function startClaudeSessionsWatcher() {
  if (claudeSessionsWatcher) return;
  if (!fs.existsSync(CLAUDE_SESSIONS_DIR)) {
    try {
      fs.mkdirSync(CLAUDE_SESSIONS_DIR, { recursive: true });
    } catch (e) {
      console.error('Failed to create Claude sessions directory:', e);
      return;
    }
  }

  try {
    claudeSessionsWatcher = fs.watch(CLAUDE_SESSIONS_DIR, { persistent: false }, () => {
      notifyClaudeSessionsUpdated();
    });
  } catch (e) {
    console.error('Failed to watch Claude sessions directory:', e);
  }
}

ipcMain.handle('claude:resolveSession', (event, { shellPid }) => {
  try {
    return resolveClaudeSessionForShellPid(shellPid);
  } catch (e) {
    console.error('Failed to resolve Claude session:', e);
    return null;
  }
});

// ─── App Lifecycle ────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startClaudeSessionsWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Clean up any remaining PTY processes
  for (const [id, ptyProc] of ptyProcesses) {
    try {
      ptyProc.kill();
    } catch (e) {
      // Ignore
    }
  }
  ptyProcesses.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
