const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  // PTY Management
  createPty: (id, cwd) => ipcRenderer.invoke('pty:create', { id, cwd }),
  writePty: (id, data) => ipcRenderer.invoke('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.invoke('pty:resize', { id, cols, rows }),
  killPty: (id) => ipcRenderer.invoke('pty:kill', { id }),

  // PTY Events
  onPtyData: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },

  onPtyExit: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },

  onPtyMeta: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('pty:meta', listener);
    return () => ipcRenderer.removeListener('pty:meta', listener);
  },

  getCommandHistory: () => ipcRenderer.invoke('commandHistory:get'),

  onCommandHistoryUpdated: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('commandHistory:updated', listener);
    return () => ipcRenderer.removeListener('commandHistory:updated', listener);
  },

  // State Persistence
  saveState: (stateData) => ipcRenderer.invoke('state:save', stateData),
  loadState: () => ipcRenderer.invoke('state:load'),
  notifySaveComplete: () => ipcRenderer.send('state:saveComplete'),

  // App lifecycle events
  onBeforeQuit: (callback) => {
    ipcRenderer.on('app:before-quit', callback);
  },

  // Git Operations
  gitStatus: (cwd) => ipcRenderer.invoke('git:status', { cwd }),
  gitDiff: (cwd, filePath, fileStatus) => ipcRenderer.invoke('git:diff', { cwd, filePath, fileStatus }),
  listProjectFiles: (cwd) => ipcRenderer.invoke('project:listFiles', { cwd }),
  readProjectFile: (cwd, filePath) => ipcRenderer.invoke('project:readFile', { cwd, filePath }),

  // Dialogs
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),

  // Claude Code monitoring
  claudeGetStatus: () => ipcRenderer.invoke('claude:getStatus'),
  claudeSetModel: (model) => ipcRenderer.invoke('claude:setModel', { model }),
  claudeStartWatching: () => ipcRenderer.invoke('claude:startWatching'),
  claudeIsRunning: () => ipcRenderer.invoke('claude:isRunning'),
  claudeSendToTerminal: (id, command) => ipcRenderer.invoke('claude:sendToTerminal', { id, command }),
  claudeResolveSession: (shellPid) => ipcRenderer.invoke('claude:resolveSession', { shellPid }),
  onClaudeSessionUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('claude:sessionUpdated', listener);
    return () => ipcRenderer.removeListener('claude:sessionUpdated', listener);
  },
  onClaudeSettingsChanged: (callback) => {
    const listener = (event, settings) => callback(settings);
    ipcRenderer.on('claude:settingsChanged', listener);
    return () => ipcRenderer.removeListener('claude:settingsChanged', listener);
  },
});
