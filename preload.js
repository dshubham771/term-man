const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  createPty: (id, cwd) => ipcRenderer.invoke('pty:create', { id, cwd }),
  writePty: (id, data) => ipcRenderer.invoke('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.invoke('pty:resize', { id, cols, rows }),
  killPty: (id) => ipcRenderer.invoke('pty:kill', { id }),

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

  // Dialogs
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
});
