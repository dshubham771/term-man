import { Sidebar } from './sidebar.js';
import { TerminalManager } from './terminal-manager.js';
import { DiffViewer } from './diff-viewer.js';
import { ProjectFilesBrowser } from './project-files.js';
import { SORT_MODES, ensureCreatedAt, moveItem, sortFolders, sortTerminals } from '../lib/sidebar-order.js';

const state = {
  folders: [],
  folderSortMode: SORT_MODES.ADDED_TIME,
  activeTerminalId: null,
  drawerMode: null, // 'changes' | 'files' | null
  drawerFolderId: null,
};

let terminalCounter = 0;

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

const emptyState = document.getElementById('empty-state');
const terminalHeader = document.getElementById('terminal-header');
const mainContent = document.getElementById('main-content');
const viewTabs = document.getElementById('view-tabs');
const breadcrumbFolder = document.getElementById('breadcrumb-folder');
const breadcrumbTerminal = document.getElementById('breadcrumb-terminal');

const rightDrawer = document.getElementById('right-drawer');
const rightDrawerHeader = document.getElementById('right-drawer-header');
const rightDrawerTitle = document.getElementById('right-drawer-title');
const rightDrawerFolder = document.getElementById('right-drawer-folder');
const changesBtn = document.getElementById('changes-btn');
const filesBtn = document.getElementById('files-btn');

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

async function openChangesDrawer(folder) {
  if (!folder) return;
  state.drawerMode = 'changes';
  state.drawerFolderId = folder.id;

  rightDrawer.classList.remove('hidden');
  rightDrawerHeader.classList.remove('hidden');
  rightDrawerTitle.textContent = 'Changes';
  rightDrawerFolder.textContent = folder.name;

  filesBrowser.hide();
  diffViewer.show();

  await fetchGitStatus(folder.id);
  const refreshedFolder = state.folders.find((f) => f.id === folder.id);
  if (refreshedFolder) {
    diffViewer.renderFileList(refreshedFolder.gitInfo?.files || [], refreshedFolder.id, refreshedFolder.path);
  }
  renderAll();
}

async function openFilesDrawer(folder) {
  if (!folder) return;
  state.drawerMode = 'files';
  state.drawerFolderId = folder.id;

  rightDrawer.classList.remove('hidden');
  rightDrawerHeader.classList.add('hidden'); // File tree hides this default header

  diffViewer.hide();
  filesBrowser.show();

  await filesBrowser.loadFolder(folder, { force: true });
  renderAll();
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

diffViewer.onRefresh = async () => {
  if (state.drawerMode !== 'changes' || !state.drawerFolderId) return;
  const folder = state.folders.find((f) => f.id === state.drawerFolderId);
  if (folder) {
    await openChangesDrawer(folder);
  }
};

diffViewer.onFileSelect = async (filePath, fileStatus) => {
  if (state.drawerMode !== 'changes' || !state.drawerFolderId) return;
  const folder = state.folders.find((f) => f.id === state.drawerFolderId);
  if (!folder) return;

  const diffData = await window.terminalAPI.gitDiff(folder.path, filePath, fileStatus);
  diffViewer.showDiff(diffData);
};

async function fetchGitStatus(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const gitInfo = await window.terminalAPI.gitStatus(folder.path);
  folder.gitInfo = gitInfo;
}

async function handleAddFolder() {
  const folderPath = await window.terminalAPI.openFolderDialog();
  if (!folderPath) return;

  if (state.folders.some((f) => f.path === folderPath)) return;

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
    terminalSortMode: SORT_MODES.ADDED_TIME,
  };

  state.folders.push(folder);
  applyFolderSort(state.folderSortMode);
  renderAll();
  await handleNewTerminal(folder.id);
}

async function handleRemoveFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
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
  renderAll();
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
  if (!success) return;

  folder.terminals.push(term);
  applyTerminalSort(folder, folder.terminalSortMode);
  folder.collapsed = false;
  state.activeTerminalId = terminalId;

  renderAll();
  terminalManager.showTerminal(terminalId);
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
}

async function handleSelectTerminal(folderId, terminalId) {
  state.activeTerminalId = terminalId;
  renderAll();
  terminalManager.showTerminal(terminalId);
}

function handleRenameTerminal(folderId, terminalId, newName) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const term = folder.terminals.find((t) => t.id === terminalId);
  if (!term) return;
  term.name = newName;
  renderAll();
  if (state.activeTerminalId) {
    terminalManager.showTerminal(state.activeTerminalId);
  }
}

function handleClearTerminal(folderId, terminalId) {
  terminalManager.clearTerminal(terminalId);
}

function handleToggleFolderCollapsed(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  folder.collapsed = !folder.collapsed;
  renderAll();
}

function handleSetFolderSortMode(mode) {
  applyFolderSort(mode);
  renderAll();
}

function handleSetTerminalSortMode(mode) {
  for (const folder of state.folders) {
    applyTerminalSort(folder, mode);
  }
  renderAll();
}

function handleReorderFolders(sourceFolderId, targetFolderId, placement) {
  const fromIndex = state.folders.findIndex((item) => item.id === sourceFolderId);
  const targetIndex = state.folders.findIndex((item) => item.id === targetFolderId);
  const toIndex = getDropIndex(fromIndex, targetIndex, placement);
  if (toIndex === fromIndex) return;

  state.folders = moveItem(state.folders, fromIndex, toIndex);
  state.folderSortMode = SORT_MODES.CUSTOM;
  renderAll();
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
}

function handleSetFolderTagColor(folderId, tagColor) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  folder.tagColor = tagColor ?? null;
  renderAll();
}

function handleSetTerminalTagColor(folderId, terminalId, tagColor) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  const terminal = folder.terminals.find((item) => item.id === terminalId);
  if (!terminal) return;
  terminal.tagColor = tagColor ?? null;
  renderAll();
}

function getDropIndex(fromIndex, targetIndex, placement) {
  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return fromIndex;
  if (placement === 'below') {
    return fromIndex < targetIndex ? targetIndex : targetIndex + 1;
  }
  return fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
}

function applyFolderSort(mode) {
  state.folderSortMode = mode;
  if (mode !== SORT_MODES.CUSTOM) {
    state.folders = sortFolders(state.folders, mode);
  }
}

function applyTerminalSort(folder, mode) {
  folder.terminalSortMode = mode;
  if (mode !== SORT_MODES.CUSTOM) {
    folder.terminals = sortTerminals(folder.terminals, mode);
  }
}

function buildSidebarRenderState() {
  return {
    ...state,
    terminalSortMode: state.folders[0]?.terminalSortMode || SORT_MODES.ADDED_TIME,
    folders: sortFolders(state.folders, state.folderSortMode).map((folder) => ({
      ...folder,
      terminals: sortTerminals(folder.terminals, folder.terminalSortMode),
    })),
  };
}

function renderAll() {
  sidebar.render(buildSidebarRenderState());

  const hasActiveTerminal = state.activeTerminalId !== null;
  const isDrawerOpen = hasActiveTerminal && state.drawerMode !== null;

  emptyState.classList.toggle('hidden', hasActiveTerminal);
  terminalHeader.classList.toggle('hidden', !hasActiveTerminal);
  mainContent.classList.toggle('drawer-open', isDrawerOpen);
  viewTabs.classList.toggle('hidden', !hasActiveTerminal);

  if (hasActiveTerminal) {
    const folder = state.folders.find((f) => f.terminals.some((t) => t.id === state.activeTerminalId));
    if (folder) {
      const terminal = folder.terminals.find((t) => t.id === state.activeTerminalId);
      breadcrumbFolder.textContent = folder.name;
      breadcrumbTerminal.textContent = terminal ? terminal.name : '';
    }
  }

  if (isDrawerOpen && state.drawerMode === 'changes') {
    diffViewer.show();
    filesBrowser.hide();
  } else if (isDrawerOpen && state.drawerMode === 'files') {
    filesBrowser.show();
    diffViewer.hide();
  } else {
    rightDrawer.classList.add('hidden');
    diffViewer.hide();
    filesBrowser.hide();
  }

  updateActionButtons();
}

document.getElementById('add-folder-btn').addEventListener('click', handleAddFolder);
document.getElementById('empty-add-folder-btn').addEventListener('click', handleAddFolder);
changesBtn.addEventListener('click', () => toggleDrawer('changes'));
filesBtn.addEventListener('click', () => toggleDrawer('files'));

renderAll();
