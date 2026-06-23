/**
 * app.js
 * Main renderer entry point. Initializes the app, manages state, and wires up components.
 */

import { Sidebar } from './sidebar.js';
import { TerminalManager } from './terminal-manager.js';
import { DiffViewer } from './diff-viewer.js';
import { ProjectFilesBrowser } from './project-files.js';
import {
  SORT_MODES,
  ensureCreatedAt,
  moveItem,
  sortFolders,
  sortTerminals,
} from '../lib/sidebar-order.js';

// ─── Application State ─────────────────────────────────────
const state = {
  folders: [],
  folderSortMode: SORT_MODES.ADDED_TIME,
  activeTerminalId: null,
  drawerMode: null, // 'changes' | 'files' | null
  drawerFolderId: null,
};

let terminalCounter = 0;
let saveTimeout = null;

// ─── Initialize Components ─────────────────────────────────
const terminalManager = new TerminalManager();
const diffViewer = new DiffViewer();
const filesBrowser = new ProjectFilesBrowser();

const sidebar = new Sidebar({
  onAddFolder: handleAddFolder,
  onRemoveFolder: handleRemoveFolder,
  onNewTerminal: handleNewTerminal,
  onCloseTerminal: handleCloseTerminal,
  onSelectTerminal: handleSelectTerminal,
  onRenameTerminal: handleRenameTerminal,
  onClearTerminal: handleClearTerminal,
  onToggleFolderCollapsed: handleToggleFolderCollapsed,
  onSetFolderSortMode: handleSetFolderSortMode,
  onSetTerminalSortMode: handleSetTerminalSortMode,
  onReorderFolders: handleReorderFolders,
  onReorderTerminals: handleReorderTerminals,
  onSetFolderTagColor: handleSetFolderTagColor,
  onSetTerminalTagColor: handleSetTerminalTagColor,
});

// ─── DOM References ─────────────────────────────────────────
const terminalHeader = document.getElementById('terminal-header');
const breadcrumbFolder = document.getElementById('breadcrumb-folder');
const breadcrumbTerminal = document.getElementById('breadcrumb-terminal');
const emptyState = document.getElementById('empty-state');
const addFolderBtn = document.getElementById('add-folder-btn');
const emptyAddFolderBtn = document.getElementById('empty-add-folder-btn');
const resizeHandle = document.getElementById('sidebar-resize-handle');
const sidebarEl = document.getElementById('sidebar');
const mainContent = document.getElementById('main-content');
const terminalContainer = document.getElementById('terminal-container');
const workspaceRow = document.getElementById('workspace-row');
const rightDrawer = document.getElementById('right-drawer');
const rightDrawerHeader = document.getElementById('right-drawer-header');
const rightDrawerTitle = document.getElementById('right-drawer-title');
const rightDrawerFolder = document.getElementById('right-drawer-folder');
const rightDrawerResizeHandle = document.getElementById('right-drawer-resize-handle');
const viewTabs = document.getElementById('view-tabs');
const changesBtn = document.getElementById('changes-btn');
const filesBtn = document.getElementById('files-btn');

const DRAWER_WIDTH_STORAGE_KEY = 'terminal-manager.drawerWidth';
const DEFAULT_DRAWER_WIDTH = 460;
const MIN_DRAWER_WIDTH = 320;
const MAX_DRAWER_WIDTH = 820;

let drawerWidth = Number(localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY));
if (!Number.isFinite(drawerWidth) || drawerWidth <= 0) {
  drawerWidth = DEFAULT_DRAWER_WIDTH;
}

function clampDrawerWidth(value) {
  const workspaceWidth = workspaceRow ? workspaceRow.getBoundingClientRect().width : window.innerWidth;
  const maxWidth = Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, workspaceWidth - 280));
  return Math.max(MIN_DRAWER_WIDTH, Math.min(maxWidth, value));
}

function setDrawerWidth(value, persist = true) {
  drawerWidth = clampDrawerWidth(value);
  rightDrawer.style.setProperty('--right-drawer-width', `${drawerWidth}px`);
  mainContent.style.setProperty('--right-drawer-width', `${drawerWidth}px`);
  if (persist) {
    localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(drawerWidth));
  }
  terminalManager.refitAll();
}

setDrawerWidth(drawerWidth, false);

// ─── Drawer Helpers ─────────────────────────────────────────
function getFolderForTerminal(terminalId) {
  return state.folders.find((folder) =>
    folder.terminals.some((terminal) => terminal.id === terminalId)
  ) || null;
}

function getActiveFolder() {
  return state.activeTerminalId ? getFolderForTerminal(state.activeTerminalId) : null;
}

function updateActionButtons() {
  changesBtn.classList.toggle('active', state.drawerMode === 'changes');
  filesBtn.classList.toggle('active', state.drawerMode === 'files');
}

function updateDrawerChrome(folder = null) {
  const targetFolder = folder || state.folders.find((f) => f.id === state.drawerFolderId) || getActiveFolder();
  if (!state.drawerMode || !targetFolder) {
    rightDrawer.classList.add('hidden');
    rightDrawerHeader.classList.add('hidden');
    return false;
  }

  rightDrawer.classList.remove('hidden');
  rightDrawerHeader.classList.toggle('hidden', state.drawerMode === 'files');
  if (state.drawerMode === 'changes') {
    rightDrawerTitle.textContent = 'Changes';
    rightDrawerFolder.textContent = targetFolder.name;
    rightDrawerFolder.title = targetFolder.path;
  }
  updateActionButtons();
  return true;
}

function closeDrawer() {
  state.drawerMode = null;
  state.drawerFolderId = null;
  rightDrawer.classList.add('hidden');
  diffViewer.hide();
  filesBrowser.hide();
  if (state.activeTerminalId) {
    terminalManager.showTerminal(state.activeTerminalId);
  }
  updateActionButtons();
}

async function openChangesDrawer(folder) {
  if (!folder) return;

  state.drawerMode = 'changes';
  state.drawerFolderId = folder.id;
  updateDrawerChrome(folder);

  closeTerminalSearch();
  filesBrowser.hide();
  diffViewer.show();

  await fetchGitStatus(folder.id);
  const refreshedFolder = state.folders.find((f) => f.id === folder.id);
  if (state.drawerMode !== 'changes' || state.drawerFolderId !== folder.id) return;
  if (refreshedFolder) {
    diffViewer.renderFileList(refreshedFolder.gitInfo?.files || [], refreshedFolder.id, refreshedFolder.path);
  }

  renderAll();
}

async function openFilesDrawer(folder) {
  if (!folder) return;

  state.drawerMode = 'files';
  state.drawerFolderId = folder.id;
  updateDrawerChrome(folder);

  closeTerminalSearch();
  diffViewer.hide();
  filesBrowser.show();

  await filesBrowser.loadFolder(folder, { force: true });
  if (state.drawerMode !== 'files' || state.drawerFolderId !== folder.id) return;

  renderAll();
}

async function toggleDrawer(mode) {
  const folder = getActiveFolder();
  if (!folder) return;

  if (state.drawerMode === mode && state.drawerFolderId === folder.id) {
    closeDrawer();
    renderAll();
    return;
  }

  if (mode === 'changes') {
    await openChangesDrawer(folder);
  } else if (mode === 'files') {
    await openFilesDrawer(folder);
  }
}

async function syncDrawerToActiveTerminal() {
  if (!state.drawerMode || !state.activeTerminalId) return;

  const folder = getActiveFolder();
  if (!folder) {
    closeDrawer();
    return;
  }

  if (folder.id !== state.drawerFolderId) {
    if (state.drawerMode === 'changes') {
      await openChangesDrawer(folder);
    } else if (state.drawerMode === 'files') {
      await openFilesDrawer(folder);
    }
  }
}

// ─── Diff Viewer Callbacks ──────────────────────────────────
diffViewer.onRefresh = async () => {
  if (!state.drawerMode || state.drawerMode !== 'changes' || !state.drawerFolderId) return;
  const folder = state.folders.find((f) => f.id === state.drawerFolderId);
  if (folder) {
    await openChangesDrawer(folder);
  }
};

diffViewer.onFileSelect = async (filePath, fileStatus) => {
  if (!state.drawerMode || state.drawerMode !== 'changes' || !state.drawerFolderId) return;

  const folder = state.folders.find((f) => f.id === state.drawerFolderId);
  if (!folder) return;

  const diffData = await window.terminalAPI.gitDiff(folder.path, filePath, fileStatus);
  diffViewer.showDiff(diffData);
};

// ─── State Persistence ──────────────────────────────────────

/** @param {{ id: string, name?: string }|null|undefined} session */
function serializeClaudeSession(session) {
  if (!session?.id) return null;
  return {
    id: session.id,
    ...(session.name ? { name: session.name } : {}),
  };
}

/** @param {{ id: string, name?: string }|null|undefined} session */
function buildClaudeResumeCommand(session) {
  if (!session?.id) return null;
  if (session.name) {
    return `claude --resume ${JSON.stringify(session.name)}`;
  }
  return `claude --resume ${session.id}`;
}

async function refreshClaudeSessions() {
  for (const folder of state.folders) {
    for (const term of folder.terminals) {
      const shellPid = terminalManager.getShellPid(term.id);
      if (!shellPid) continue;

      const live = await window.terminalAPI.claudeResolveSession(shellPid);
      if (live?.sessionId) {
        term.claudeSession = {
          id: live.sessionId,
          ...(live.name ? { name: live.name } : {}),
        };
      }
    }
  }
}

function getTerminalSortPreference() {
  if (state.folders.length > 0 && state.folders.every((folder) => folder.terminalSortMode === SORT_MODES.CUSTOM)) {
    return SORT_MODES.CUSTOM;
  }
  const autoFolder = state.folders.find((folder) => folder.terminalSortMode !== SORT_MODES.CUSTOM);
  return autoFolder?.terminalSortMode || SORT_MODES.ADDED_TIME;
}

function applyFolderSort(mode = state.folderSortMode) {
  state.folderSortMode = mode;
  if (mode !== SORT_MODES.CUSTOM) {
    state.folders = sortFolders(state.folders, mode);
  }
}

function applyTerminalSort(folder, mode = folder?.terminalSortMode || SORT_MODES.ADDED_TIME) {
  if (!folder) return;
  folder.terminalSortMode = mode;
  if (mode !== SORT_MODES.CUSTOM) {
    folder.terminals = sortTerminals(folder.terminals, mode);
  }
}

function applyTerminalSortToAll(mode) {
  for (const folder of state.folders) {
    applyTerminalSort(folder, mode);
  }
}

function buildSidebarRenderState() {
  return {
    ...state,
    terminalSortMode: getTerminalSortPreference(),
    folders: sortFolders(state.folders, state.folderSortMode).map((folder) => ({
      ...folder,
      terminals: sortTerminals(folder.terminals, folder.terminalSortMode),
    })),
  };
}

async function showClaudeResumeHint(terminalId, claudeSession) {
  const command = buildClaudeResumeCommand(claudeSession);
  if (!command) return;

  const message = `To resume last claude code session run: ${command}`;
  terminalManager.writeResumeHint(terminalId, message);
  // Wake the shell so the prompt is ready for input (avoids needing Enter first)
  await window.terminalAPI.writePty(terminalId, '\r');
}

async function runPendingClaudeResumeHints(pending) {
  if (pending.length === 0) return;

  // Wait for shells to finish booting before writing the hint
  await new Promise((resolve) => setTimeout(resolve, 800));

  for (const { terminalId, claudeSession } of pending) {
    await showClaudeResumeHint(terminalId, claudeSession);
  }
}

async function saveState() {
  await refreshClaudeSessions();

  const stateToSave = {
    folderSortMode: state.folderSortMode,
    folders: state.folders.map((folder) => ({
      id: folder.id,
      path: folder.path,
      name: folder.name,
      collapsed: folder.collapsed,
      createdAt: folder.createdAt,
      tagColor: folder.tagColor ?? null,
      terminalSortMode: folder.terminalSortMode || SORT_MODES.ADDED_TIME,
      terminals: folder.terminals.map((term) => {
        const serialized = {
          id: term.id,
          name: term.name,
          createdAt: term.createdAt,
          tagColor: term.tagColor ?? null,
        };
        const claudeSession = serializeClaudeSession(term.claudeSession);
        if (claudeSession) {
          serialized.claudeSession = claudeSession;
        }
        return serialized;
      }),
    })),
    activeTerminalId: state.activeTerminalId,
  };

  await window.terminalAPI.saveState(stateToSave);
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveState();
  }, 2000);
}

async function restoreState() {
  const savedState = await window.terminalAPI.loadState();
  if (!savedState || !savedState.folders || savedState.folders.length === 0) {
    return;
  }

  state.folderSortMode = savedState.folderSortMode || SORT_MODES.ADDED_TIME;

  let terminalToActivate = savedState.activeTerminalId;
  let firstTerminalId = null;
  /** @type {{ terminalId: string, claudeSession: { id: string, name?: string } }[]} */
  const pendingClaudeResumes = [];

  for (const folder of ensureCreatedAt(savedState.folders)) {
    const savedTerminals = ensureCreatedAt(folder.terminals || []);
    const restoredFolder = {
      id: folder.id,
      path: folder.path,
      name: folder.name,
      collapsed: folder.collapsed || false,
      terminals: [],
      gitInfo: null,
      createdAt: folder.createdAt,
      tagColor: folder.tagColor ?? null,
      terminalSortMode: folder.terminalSortMode || SORT_MODES.ADDED_TIME,
    };

    state.folders.push(restoredFolder);

    for (const term of savedTerminals) {
      terminalCounter++;
      const newTerminalId = `term-${Date.now()}-${terminalCounter}`;

      const success = await terminalManager.createTerminal(newTerminalId, folder.path);
      if (!success) {
        console.error(`Failed to restore terminal "${term.name}" in ${folder.path}`);
        continue;
      }

      const claudeSession = term.claudeSession?.id
        ? {
            id: term.claudeSession.id,
            ...(term.claudeSession.name ? { name: term.claudeSession.name } : {}),
          }
        : null;

      restoredFolder.terminals.push({
        id: newTerminalId,
        name: term.name,
        claudeSession,
        createdAt: term.createdAt,
        tagColor: term.tagColor ?? null,
      });

      if (claudeSession) {
        pendingClaudeResumes.push({ terminalId: newTerminalId, claudeSession });
      }

      if (!firstTerminalId) {
        firstTerminalId = newTerminalId;
      }
      if (term.id === savedState.activeTerminalId) {
        terminalToActivate = newTerminalId;
      }
    }
  }

  if (terminalToActivate && !state.folders.some((f) =>
    f.terminals.some((t) => t.id === terminalToActivate)
  )) {
    terminalToActivate = firstTerminalId;
  }

  if (terminalToActivate) {
    state.activeTerminalId = terminalToActivate;
    terminalManager.showTerminal(terminalToActivate);
  }

  applyFolderSort(state.folderSortMode);
  for (const folder of state.folders) {
    applyTerminalSort(folder, folder.terminalSortMode || SORT_MODES.ADDED_TIME);
  }

  renderAll();

  await runPendingClaudeResumeHints(pendingClaudeResumes);

  // Fetch git status for all folders (non-blocking)
  refreshAllGitStatus();
}

// ─── Git Status ─────────────────────────────────────────────

async function fetchGitStatus(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;

  const gitInfo = await window.terminalAPI.gitStatus(folder.path);
  folder.gitInfo = gitInfo;
}

async function refreshAllGitStatus() {
  await Promise.all(state.folders.map((f) => fetchGitStatus(f.id)));
  renderAll();

  // If the changes drawer is open, refresh file list too
  if (state.drawerMode === 'changes' && state.drawerFolderId) {
    const folder = state.folders.find((f) => f.id === state.drawerFolderId);
    if (folder && folder.gitInfo) {
      diffViewer.renderFileList(folder.gitInfo.files, folder.id, folder.path);
    }
  }
}

// ─── Event Handlers ─────────────────────────────────────────

async function handleAddFolder() {
  const folderPath = await window.terminalAPI.openFolderDialog();
  if (!folderPath) return;

  if (state.folders.some((f) => f.path === folderPath)) {
    return;
  }

  const folderName = folderPath.split('/').pop() || folderPath;
  const folder = {
    id: `folder-${Date.now()}`,
    path: folderPath,
    name: folderName,
    collapsed: false,
    terminals: [],
    gitInfo: null,
    createdAt: Date.now(),
    tagColor: null,
    terminalSortMode: getTerminalSortPreference(),
  };

  state.folders.push(folder);
  if (state.folderSortMode !== SORT_MODES.CUSTOM) {
    applyFolderSort(state.folderSortMode);
  }
  renderAll();

  await handleNewTerminal(folder.id);
  scheduleSave();

  // Fetch git status for the new folder
  fetchGitStatus(folder.id).then(() => renderAll());
}

async function handleRemoveFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;

  if (folder.terminals.length > 0) {
    const confirmed = await showConfirmDialog(
      'Remove Folder?',
      `"${folder.name}" has ${folder.terminals.length} running terminal(s). Removing the folder will close all associated terminals.`
    );
    if (!confirmed) return;
  }

  for (const term of folder.terminals) {
    await terminalManager.destroyTerminal(term.id);
  }

  state.folders = state.folders.filter((f) => f.id !== folderId);

  if (state.activeTerminalId && folder.terminals.some((t) => t.id === state.activeTerminalId)) {
    state.activeTerminalId = null;
  }

  if (state.drawerFolderId === folderId) {
    closeDrawer();
  }

  if (!state.activeTerminalId) {
    closeDrawer();
  }

  renderAll();
  await syncDrawerToActiveTerminal();
  scheduleSave();
}

async function handleNewTerminal(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;

  terminalCounter++;
  const terminalId = `term-${Date.now()}-${terminalCounter}`;
  const terminalName = `Terminal ${folder.terminals.length + 1}`;

  const term = {
    id: terminalId,
    name: terminalName,
    claudeSession: null,
    createdAt: Date.now(),
    tagColor: null,
  };

  const success = await terminalManager.createTerminal(terminalId, folder.path);
  if (!success) {
    console.error('Failed to create terminal');
    return;
  }

  folder.terminals.push(term);
  if (folder.terminalSortMode !== SORT_MODES.CUSTOM) {
    applyTerminalSort(folder, folder.terminalSortMode);
  }
  folder.collapsed = false;
  state.activeTerminalId = terminalId;

  renderAll();
  terminalManager.showTerminal(terminalId);
  await syncDrawerToActiveTerminal();
  scheduleSave();
}

async function handleCloseTerminal(folderId, terminalId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;

  await terminalManager.destroyTerminal(terminalId);
  folder.terminals = folder.terminals.filter((t) => t.id !== terminalId);

  if (state.activeTerminalId === terminalId) {
    state.activeTerminalId = null;

    if (folder.terminals.length > 0) {
      state.activeTerminalId = folder.terminals[folder.terminals.length - 1].id;
    } else {
      for (const f of state.folders) {
        if (f.terminals.length > 0) {
          state.activeTerminalId = f.terminals[f.terminals.length - 1].id;
          break;
        }
      }
    }
  }

  renderAll();

  if (state.activeTerminalId) {
    terminalManager.showTerminal(state.activeTerminalId);
  }

  if (!state.activeTerminalId) {
    closeDrawer();
  }

  await syncDrawerToActiveTerminal();

  scheduleSave();
}

async function handleSelectTerminal(folderId, terminalId) {
  state.activeTerminalId = terminalId;

  renderAll();
  terminalManager.showTerminal(terminalId);
  await syncDrawerToActiveTerminal();
}

function handleRenameTerminal(folderId, terminalId, newName) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;

  const term = folder.terminals.find((t) => t.id === terminalId);
  if (!term) return;

  term.name = newName;
  if (folder.terminalSortMode === SORT_MODES.NAME) {
    applyTerminalSort(folder, SORT_MODES.NAME);
  }
  renderAll();

  if (state.activeTerminalId) {
    terminalManager.showTerminal(state.activeTerminalId);
  }

  saveState();
}

function handleClearTerminal(folderId, terminalId) {
  terminalManager.clearTerminal(terminalId);
  scheduleSave();
}

function handleToggleFolderCollapsed(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  folder.collapsed = !folder.collapsed;
  renderAll();
  scheduleSave();
}

function handleSetFolderSortMode(mode) {
  applyFolderSort(mode);
  renderAll();
  scheduleSave();
}

function handleSetTerminalSortMode(mode) {
  applyTerminalSortToAll(mode);
  renderAll();
  scheduleSave();
}

function getDropIndex(fromIndex, targetIndex, placement) {
  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return fromIndex;
  if (placement === 'below') {
    return fromIndex < targetIndex ? targetIndex : targetIndex + 1;
  }
  return fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
}

function handleReorderFolders(sourceFolderId, targetFolderId, placement) {
  const fromIndex = state.folders.findIndex((item) => item.id === sourceFolderId);
  const targetIndex = state.folders.findIndex((item) => item.id === targetFolderId);
  const toIndex = getDropIndex(fromIndex, targetIndex, placement);
  if (toIndex === fromIndex) return;

  state.folders = moveItem(state.folders, fromIndex, toIndex);
  state.folderSortMode = SORT_MODES.CUSTOM;
  renderAll();
  scheduleSave();
}

function handleReorderTerminals(folderId, sourceTerminalId, targetTerminalId, placement) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;

  const fromIndex = folder.terminals.findIndex((item) => item.id === sourceTerminalId);
  const targetIndex = folder.terminals.findIndex((item) => item.id === targetTerminalId);
  const toIndex = getDropIndex(fromIndex, targetIndex, placement);
  if (toIndex === fromIndex) return;

  folder.terminals = moveItem(folder.terminals, fromIndex, toIndex);
  folder.terminalSortMode = SORT_MODES.CUSTOM;
  renderAll();
  scheduleSave();
}

function handleSetFolderTagColor(folderId, tagColor) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  folder.tagColor = tagColor ?? null;
  renderAll();
  scheduleSave();
}

function handleSetTerminalTagColor(folderId, terminalId, tagColor) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  const terminal = folder.terminals.find((item) => item.id === terminalId);
  if (!terminal) return;
  terminal.tagColor = tagColor ?? null;
  renderAll();
  scheduleSave();
}

// ─── Rendering ──────────────────────────────────────────────

function renderAll() {
  sidebar.render(buildSidebarRenderState());

  const hasActiveTerminal = state.activeTerminalId !== null;
  const isDrawerOpen = hasActiveTerminal && state.drawerMode !== null;

  if (!hasActiveTerminal && state.drawerMode) {
    closeDrawer();
  }

  // Toggle empty state
  emptyState.classList.toggle('hidden', hasActiveTerminal);
  terminalHeader.classList.toggle('hidden', !hasActiveTerminal);
  mainContent.classList.toggle('drawer-open', isDrawerOpen);

  // Show workspace actions whenever a terminal is active
  viewTabs.classList.toggle('hidden', !hasActiveTerminal);

  // Update breadcrumb
  if (hasActiveTerminal) {
    const folder = state.folders.find((f) =>
      f.terminals.some((t) => t.id === state.activeTerminalId)
    );
    if (folder) {
      const terminal = folder.terminals.find((t) => t.id === state.activeTerminalId);
      breadcrumbFolder.textContent = folder.name;
      breadcrumbTerminal.textContent = terminal ? terminal.name : '';
    }
  }

  // Toggle drawer content
  if (isDrawerOpen && state.drawerMode === 'changes') {
    updateDrawerChrome();
    diffViewer.show();
    filesBrowser.hide();
  } else if (isDrawerOpen && state.drawerMode === 'files') {
    updateDrawerChrome();
    filesBrowser.show();
    diffViewer.hide();
  } else {
    rightDrawer.classList.add('hidden');
    diffViewer.hide();
    filesBrowser.hide();
  }

  updateActionButtons();
}

// ─── Confirm Dialog ─────────────────────────────────────────

function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="confirm-dialog-actions">
          <button class="confirm-btn cancel">Cancel</button>
          <button class="confirm-btn danger">Remove</button>
        </div>
      </div>
    `;

    const cleanup = () => overlay.remove();

    overlay.querySelector('.cancel').addEventListener('click', () => {
      cleanup();
      resolve(false);
    });

    overlay.querySelector('.danger').addEventListener('click', () => {
      cleanup();
      resolve(true);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    });

    document.body.appendChild(overlay);
  });
}

// ─── Sidebar Resize ─────────────────────────────────────────

let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeHandle.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const newWidth = Math.max(220, Math.min(480, e.clientX));
  sidebarEl.style.width = `${newWidth}px`;
  terminalManager.refitAll();
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    terminalManager.refitAll();
  }
});

// ─── Terminal Search ─────────────────────────────────────────

const terminalSearchBar = document.getElementById('terminal-search-bar');
const terminalSearchInput = document.getElementById('terminal-search-input');
const terminalSearchCount = document.getElementById('terminal-search-count');
const terminalSearchPrev = document.getElementById('terminal-search-prev');
const terminalSearchNext = document.getElementById('terminal-search-next');
const terminalSearchClose = document.getElementById('terminal-search-close');
const terminalSearchCaseCb = document.getElementById('terminal-search-case-cb');
const terminalSearchRegexCb = document.getElementById('terminal-search-regex-cb');

function getSearchOptions() {
  return {
    caseSensitive: terminalSearchCaseCb.checked,
    regex: terminalSearchRegexCb.checked,
  };
}

function openTerminalSearch() {
  if (!state.activeTerminalId) return;
  terminalSearchBar.classList.remove('hidden');
  terminalSearchInput.focus();
  terminalSearchInput.select();
}

function closeTerminalSearch() {
  terminalSearchBar.classList.add('hidden');
  // Return focus to the active terminal
  if (state.activeTerminalId) {
    const entry = terminalManager.terminals.get(state.activeTerminalId);
    if (entry) entry.terminal.focus();
  }
}

function runSearch(direction = 'next') {
  const query = terminalSearchInput.value;
  if (!query) {
    terminalSearchCount.textContent = '';
    return;
  }
  const opts = getSearchOptions();
  const found = direction === 'next'
    ? terminalManager.searchNext(query, opts)
    : terminalManager.searchPrevious(query, opts);
  terminalSearchCount.textContent = found ? '' : 'No results';
}

terminalSearchInput.addEventListener('input', () => runSearch('next'));

terminalSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runSearch(e.shiftKey ? 'prev' : 'next');
  } else if (e.key === 'Escape') {
    closeTerminalSearch();
  }
});

terminalSearchNext.addEventListener('click', () => runSearch('next'));
terminalSearchPrev.addEventListener('click', () => runSearch('prev'));
terminalSearchClose.addEventListener('click', closeTerminalSearch);
terminalSearchCaseCb.addEventListener('change', () => runSearch('next'));
terminalSearchRegexCb.addEventListener('change', () => runSearch('next'));

// Cmd+F (macOS) / Ctrl+F (Windows/Linux) opens search when terminal is focused
window.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const trigger = isMac ? (e.metaKey && e.key === 'f') : (e.ctrlKey && e.key === 'f');
  if (trigger && state.activeTerminalId) {
    e.preventDefault();
    openTerminalSearch();
  }
});

// ─── Button Event Listeners ─────────────────────────────────
addFolderBtn.addEventListener('click', handleAddFolder);
emptyAddFolderBtn.addEventListener('click', handleAddFolder);
changesBtn.addEventListener('click', () => {
  toggleDrawer('changes');
});
filesBtn.addEventListener('click', () => {
  toggleDrawer('files');
});
let isResizingDrawer = false;

rightDrawerResizeHandle.addEventListener('mousedown', (e) => {
  if (rightDrawer.classList.contains('hidden')) return;
  isResizingDrawer = true;
  rightDrawerResizeHandle.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizingDrawer) return;

  const bounds = workspaceRow.getBoundingClientRect();
  const newWidth = bounds.right - e.clientX;
  setDrawerWidth(newWidth, false);
  updateDrawerChrome();
});

document.addEventListener('mouseup', () => {
  if (!isResizingDrawer) return;

  isResizingDrawer = false;
  rightDrawerResizeHandle.classList.remove('resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  setDrawerWidth(drawerWidth, true);
});

// ─── Auto-Save & Quit Handling ──────────────────────────────

setInterval(() => {
  if (state.folders.length > 0) {
    saveState();
  }
}, 30000);

window.terminalAPI.onBeforeQuit(async () => {
  await saveState();
  window.terminalAPI.notifySaveComplete();
});

// window.addEventListener('blur', () => {
//   if (state.folders.length > 0) {
//     saveState();
//   }
// });

// ─── Git Polling ────────────────────────────────────────────

// Refresh git status every 10 seconds
// setInterval(() => {
//   if (state.folders.length > 0) {
//     refreshAllGitStatus();
//   }
// }, 10000);

// ─── Startup ────────────────────────────────────────────────

window.terminalAPI.onClaudeSessionUpdated(async () => {
  await refreshClaudeSessions();
  scheduleSave();
});

restoreState().then(() => {
  renderAll();
});
