import { TerminalManager } from './terminal-manager.js';

const terminalManager = new TerminalManager();

// Basic state loading skeleton
async function restoreState() {
  const savedState = await window.terminalAPI.loadState();
  if (savedState) {
    console.log('Restored state:', savedState);
  }
}

async function saveState() {
  const stateToSave = { timestamp: Date.now() };
  await window.terminalAPI.saveState(stateToSave);
}

window.terminalAPI.onBeforeQuit(async () => {
  await saveState();
  window.terminalAPI.notifySaveComplete();
});

restoreState();
