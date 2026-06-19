/**
 * project-files.js
 * Renders a read-only file tree for the active project and shows an in-app
 * preview for the selected file.
 */

import { renderMarkdownPreview } from './diff-viewer.js';

const FILE_LANGUAGE_MAP = {
  '.cjs': 'javascript',
  '.css': 'css',
  '.go': 'go',
  '.graphql': 'graphql',
  '.htm': 'html',
  '.html': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.less': 'less',
  '.mjs': 'javascript',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mts': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'shell',
  '.sql': 'sql',
  '.svelte': 'html',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.vue': 'html',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell',
};

const FILES_TREE_WIDTH_STORAGE_KEY = 'terminal-manager.filesTreeWidth';
const DEFAULT_FILES_TREE_WIDTH = 360;
const MIN_FILES_TREE_WIDTH = 220;
const MAX_FILES_TREE_WIDTH = 680;

function createTreeNode(name, pathValue, type) {
  return {
    name,
    path: pathValue,
    type,
    children: [],
    childMap: new Map(),
  };
}

function sortTree(node) {
  node.children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  node.children.forEach((child) => {
    if (child.type === 'dir') {
      sortTree(child);
    }
  });
}

function buildTree(paths) {
  const root = createTreeNode('', '', 'dir');

  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean);
    let cursor = root;
    let currentPath = '';

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      const nextType = isLeaf ? 'file' : 'dir';
      let child = cursor.childMap.get(part);

      if (!child) {
        child = createTreeNode(part, currentPath, nextType);
        cursor.childMap.set(part, child);
        cursor.children.push(child);
      } else if (!isLeaf) {
        child.type = 'dir';
      }

      cursor = child;
    });
  }

  sortTree(root);
  return root;
}

function getMonacoLanguage(filePath) {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return 'plaintext';
  return FILE_LANGUAGE_MAP[filePath.slice(dotIndex).toLowerCase()] || 'plaintext';
}

function getFileName(filePath) {
  return filePath.split('/').pop() || filePath;
}

function isMarkdownPath(filePath) {
  return /\.(md|markdown)$/i.test(filePath || '');
}

export class ProjectFilesBrowser {
  constructor() {
    this.container = document.getElementById('files-container');
    this.headerLabel = document.getElementById('files-folder-label');
    this.refreshBtn = document.getElementById('files-refresh-btn');
    this.body = document.getElementById('files-body');
    this.treePane = document.getElementById('files-tree-pane');
    this.treeResizeHandle = document.getElementById('files-tree-resize-handle');
    this.previewPane = document.getElementById('files-preview-pane');
    this.treeEl = document.getElementById('files-tree');
    this.emptyStateEl = document.getElementById('files-empty-state');
    this.previewEmptyEl = document.getElementById('files-preview-empty-state');
    this.previewLoadingEl = document.getElementById('files-preview-loading');
    this.previewErrorEl = document.getElementById('files-preview-error');
    this.previewHeaderEl = document.getElementById('files-preview-header');
    this.previewNameEl = document.getElementById('files-preview-name');
    this.previewPathEl = document.getElementById('files-preview-path');
    this.previewMarkdownEl = document.getElementById('files-preview-markdown');
    this.previewEditorMount = document.getElementById('files-preview-editor');

    this.currentFolderId = null;
    this.currentFolderPath = null;
    this.currentFolderName = '';
    this.currentFiles = [];
    this.selectedFilePath = null;
    this._expandedDirs = new Set();
    this._loading = false;
    this._loadToken = 0;
    this._previewToken = 0;
    this._previewEditor = null;
    this._previewModel = null;
    this._previewFilePath = null;
    this._resizingTree = false;

    let savedTreeWidth = Number(localStorage.getItem(FILES_TREE_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(savedTreeWidth) || savedTreeWidth <= 0) {
      savedTreeWidth = DEFAULT_FILES_TREE_WIDTH;
    }
    this.filesTreeWidth = savedTreeWidth;

    this._resizeObserver = new ResizeObserver(() => {
      if (this._previewEditor && !this.previewEditorMount.classList.contains('hidden')) {
        this._previewEditor.layout();
      }
    });
    this._resizeObserver.observe(this.previewPane);

    this._bodyResizeObserver = new ResizeObserver(() => {
      this._setFilesTreeWidth(this.filesTreeWidth, false);
    });
    this._bodyResizeObserver.observe(this.body);

    this.refreshBtn.addEventListener('click', () => {
      this.refresh();
    });

    this.treeResizeHandle.addEventListener('mousedown', (event) => {
      if (this.container.classList.contains('hidden')) return;
      this._resizingTree = true;
      this.treeResizeHandle.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!this._resizingTree) return;
      const bounds = this.body.getBoundingClientRect();
      this._setFilesTreeWidth(event.clientX - bounds.left, false);
    });

    document.addEventListener('mouseup', () => {
      if (!this._resizingTree) return;
      this._resizingTree = false;
      this.treeResizeHandle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this._setFilesTreeWidth(this.filesTreeWidth, true);
    });

    this._setFilesTreeWidth(this.filesTreeWidth, false);
  }

  show() {
    this.container.classList.remove('hidden');
    this._setFilesTreeWidth(this.filesTreeWidth, false);
    if (!this.selectedFilePath) {
      this._showPreviewIdle();
    }
  }

  hide() {
    this.container.classList.add('hidden');
  }

  async loadFolder(folder, { force = false } = {}) {
    if (!folder || !folder.path) {
      this.clear();
      return;
    }

    const folderChanged = this.currentFolderId !== folder.id;
    this.currentFolderId = folder.id;
    this.currentFolderPath = folder.path;
    this.currentFolderName = folder.name || folder.path;
    this.headerLabel.textContent = this.currentFolderName;

    if (folderChanged) {
      this.selectedFilePath = null;
      this._expandedDirs.clear();
      this._clearPreview();
    }

    if (force || folderChanged || this.currentFiles.length === 0) {
      await this._loadFiles(folder.path);
    } else {
      this._render();
    }

    if (!this.selectedFilePath) {
      this._showPreviewIdle();
    }
  }

  async refresh() {
    if (!this.currentFolderPath) return;
    await this._loadFiles(this.currentFolderPath);
  }

  clear() {
    this._loadToken += 1;
    this._previewToken += 1;
    this.currentFolderId = null;
    this.currentFolderPath = null;
    this.currentFolderName = '';
    this.currentFiles = [];
    this.selectedFilePath = null;
    this._expandedDirs.clear();
    this._loading = false;
    this.headerLabel.textContent = '';
    this.treeEl.innerHTML = '';
    this.emptyStateEl.classList.remove('hidden');
    this._clearPreview();
    this._setFilesTreeWidth(this.filesTreeWidth, false);
  }

  async _loadFiles(folderPath) {
    const loadToken = ++this._loadToken;
    this._loading = true;
    this.treeEl.innerHTML = `
      <div class="files-loading">
        <span class="files-loading-dot"></span>
        Loading project files
      </div>
    `;
    this.emptyStateEl.classList.add('hidden');

    try {
      const result = await window.terminalAPI.listProjectFiles(folderPath);
      if (loadToken !== this._loadToken || this.currentFolderPath !== folderPath) {
        return;
      }
      this.currentFiles = Array.isArray(result.files) ? result.files : [];
      this._render();
    } catch (error) {
      if (loadToken !== this._loadToken) {
        return;
      }
      console.error('Failed to load project files:', error);
      this.currentFiles = [];
      this.treeEl.innerHTML = '';
      this.emptyStateEl.classList.remove('hidden');
      this._showPreviewError('Failed to load project files');
    } finally {
      if (loadToken === this._loadToken) {
        this._loading = false;
      }
    }
  }

  _render() {
    this.treeEl.innerHTML = '';

    if (!this.currentFiles.length) {
      this.emptyStateEl.classList.remove('hidden');
      this._showPreviewIdle();
      return;
    }

    if (this.selectedFilePath && !this.currentFiles.includes(this.selectedFilePath)) {
      this.selectedFilePath = null;
      this._clearPreview();
    }

    this.emptyStateEl.classList.add('hidden');
    const treeRoot = buildTree(this.currentFiles);
    const treeEl = document.createElement('div');
    treeEl.className = 'files-tree';

    treeRoot.children.forEach((child) => {
      treeEl.appendChild(this._renderNode(child, 0));
    });

    this.treeEl.appendChild(treeEl);
  }

  _renderNode(node, depth) {
    const wrapper = document.createElement('div');
    wrapper.className = `files-node ${node.type}`;
    wrapper.dataset.path = node.path;

    if (node.type === 'dir') {
      const isExpanded = depth === 0 || this._expandedDirs.has(node.path);
      wrapper.classList.toggle('expanded', isExpanded);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'files-row files-dir-row';
      row.style.paddingLeft = `${14 + depth * 14}px`;

      const chevron = document.createElement('span');
      chevron.className = 'files-chevron';
      chevron.textContent = isExpanded ? '▾' : '▸';

      const icon = document.createElement('span');
      icon.className = 'files-icon';
      icon.textContent = '📁';

      const name = document.createElement('span');
      name.className = 'files-name';
      name.title = node.path;
      name.textContent = node.name;

      row.appendChild(chevron);
      row.appendChild(icon);
      row.appendChild(name);

      row.addEventListener('click', () => {
        if (this._expandedDirs.has(node.path)) {
          this._expandedDirs.delete(node.path);
        } else {
          this._expandedDirs.add(node.path);
        }
        this._render();
      });

      wrapper.appendChild(row);

      if (isExpanded && node.children.length > 0) {
        const childrenEl = document.createElement('div');
        childrenEl.className = 'files-children';
        node.children.forEach((child) => {
          childrenEl.appendChild(this._renderNode(child, depth + 1));
        });
        wrapper.appendChild(childrenEl);
      }

      return wrapper;
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `files-row files-file-row${node.path === this.selectedFilePath ? ' active' : ''}`;
    row.style.paddingLeft = `${14 + depth * 14}px`;

    const chevron = document.createElement('span');
    chevron.className = 'files-chevron files-chevron-placeholder';

    const icon = document.createElement('span');
    icon.className = 'files-icon';
    icon.textContent = '📄';

    const name = document.createElement('span');
    name.className = 'files-name';
    name.title = node.path;
    name.textContent = node.name;

    row.appendChild(chevron);
    row.appendChild(icon);
    row.appendChild(name);

    row.addEventListener('click', () => {
      this.selectedFilePath = node.path;
      this._highlightSelection();
      this._previewFile(node.path);
    });

    wrapper.appendChild(row);
    return wrapper;
  }

  async _previewFile(filePath) {
    if (!this.currentFolderPath) return;

    const previewToken = ++this._previewToken;
    this._setPreviewLoading(filePath);

    try {
      const result = await window.terminalAPI.readProjectFile(this.currentFolderPath, filePath);
      if (previewToken !== this._previewToken || this.currentFolderPath == null) {
        return;
      }

      if (!result?.success) {
        this._showPreviewError(result?.error || 'Failed to read file');
        return;
      }

      if (isMarkdownPath(filePath)) {
        this._showMarkdownPreview(filePath, result.content || '');
        return;
      }

      const monaco = await window.monacoReady;
      if (previewToken !== this._previewToken || this.currentFolderPath == null) {
        return;
      }

      const nextModel = monaco.editor.createModel(
        result.content || '',
        getMonacoLanguage(filePath),
        monaco.Uri.parse(`preview:///${filePath}`)
      );

      if (!this._previewEditor) {
        this._previewEditor = monaco.editor.create(this.previewEditorMount, {
          theme: 'vs-dark',
          automaticLayout: true,
          readOnly: true,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          wordWrap: 'off',
          folding: true,
          glyphMargin: false,
          lineNumbersMinChars: 4,
          overviewRulerLanes: 0,
          padding: { top: 8 },
        });
      }

      this._disposePreviewModel();
      this._previewModel = nextModel;
      this._previewFilePath = filePath;
      this.previewMarkdownEl.innerHTML = '';
      this._showPreviewEditor(filePath);
      this._previewEditor.setModel(nextModel);
      this._previewEditor.layout();

    } catch (error) {
      if (previewToken !== this._previewToken) {
        return;
      }
      console.error('Failed to preview project file:', error);
      this._showPreviewError(error?.message || 'Failed to preview file');
    }
  }

  _highlightSelection() {
    this.treeEl.querySelectorAll('.files-file-row').forEach((row) => {
      row.classList.toggle('active', row.closest('.files-node')?.dataset.path === this.selectedFilePath);
    });
  }

  _clearPreview() {
    this._previewToken += 1;
    this._previewFilePath = null;
    this.previewMarkdownEl.innerHTML = '';
    this.previewErrorEl.textContent = '';
    this.previewLoadingEl.textContent = '';
    this.previewNameEl.textContent = '';
    this.previewPathEl.textContent = '';
    this._setPreviewState('idle');
    this._disposePreviewModel();
  }

  _showPreviewIdle() {
    this.previewMarkdownEl.innerHTML = '';
    this.previewNameEl.textContent = '';
    this.previewPathEl.textContent = '';
    this.previewErrorEl.textContent = '';
    this.previewLoadingEl.textContent = '';
    this._disposePreviewModel();
    this._setPreviewState('idle');
  }

  _setPreviewLoading(filePath) {
    this._setPreviewState('loading');
    this.previewLoadingEl.textContent = `Loading ${getFileName(filePath)}...`;
    this.previewErrorEl.textContent = '';
  }

  _showPreviewError(message) {
    this.previewMarkdownEl.innerHTML = '';
    this.previewNameEl.textContent = '';
    this.previewPathEl.textContent = '';
    this._disposePreviewModel();
    this._setPreviewState('error');
    this.previewErrorEl.textContent = message;
  }

  _showPreviewEditor(filePath) {
    this.previewMarkdownEl.classList.add('hidden');
    this._setPreviewState('editor');
    this.previewNameEl.textContent = getFileName(filePath);
    this.previewPathEl.textContent = filePath;
  }

  _showMarkdownPreview(filePath, content) {
    this._disposePreviewModel();
    this.previewMarkdownEl.innerHTML = renderMarkdownPreview(content);
    this._showPreviewMarkdown(filePath);
  }

  _showPreviewMarkdown(filePath) {
    this._setPreviewState('markdown');
    this.previewNameEl.textContent = getFileName(filePath);
    this.previewPathEl.textContent = filePath;
  }

  _disposePreviewModel() {
    if (this._previewEditor) {
      this._previewEditor.setModel(null);
    }

    if (this._previewModel) {
      this._previewModel.dispose();
      this._previewModel = null;
    }
  }

  _clampFilesTreeWidth(value) {
    const bodyWidth = this.body ? this.body.getBoundingClientRect().width : this.container.getBoundingClientRect().width;
    const maxWidth = Math.max(MIN_FILES_TREE_WIDTH, Math.min(MAX_FILES_TREE_WIDTH, bodyWidth - 280));
    return Math.max(MIN_FILES_TREE_WIDTH, Math.min(maxWidth, value));
  }

  _setFilesTreeWidth(value, persist = true) {
    this.filesTreeWidth = this._clampFilesTreeWidth(value);
    this.body.style.setProperty('--files-tree-width', `${this.filesTreeWidth}px`);
    if (persist) {
      localStorage.setItem(FILES_TREE_WIDTH_STORAGE_KEY, String(this.filesTreeWidth));
    }
    if (this._previewEditor && !this.previewEditorMount.classList.contains('hidden')) {
      this._previewEditor.layout();
    }
  }

  _setPreviewState(state) {
    const isIdle = state === 'idle';
    const isLoading = state === 'loading';
    const isError = state === 'error';
    const isEditor = state === 'editor';
    const isMarkdown = state === 'markdown';

    this.previewEmptyEl.classList.toggle('hidden', !isIdle);
    this.previewLoadingEl.classList.toggle('hidden', !isLoading);
    this.previewErrorEl.classList.toggle('hidden', !isError);
    this.previewHeaderEl.classList.toggle('hidden', !(isEditor || isMarkdown));
    this.previewEditorMount.classList.toggle('hidden', !isEditor);
    this.previewMarkdownEl.classList.toggle('hidden', !isMarkdown);

    if (isIdle) {
      this.previewEmptyEl.textContent = 'Select a file to preview';
      this.previewErrorEl.textContent = '';
      this.previewLoadingEl.textContent = '';
    }

    if (this._previewEditor && !this.previewEditorMount.classList.contains('hidden')) {
      this._previewEditor.layout();
    }
  }
}
