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
});
