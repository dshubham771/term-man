/**
 * diff-viewer.js
 * Manages the Monaco diff editor and changed files list.
 */

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  const trimmed = url.trim();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('#')
  ) {
    return trimmed;
  }
  return '#';
}

function parseInlineMarkdown(text) {
  const codeSegments = [];
  let html = escapeHtml(text);

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE_${codeSegments.length}@@`;
    codeSegments.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safeUrl = sanitizeUrl(url);
    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  return html.replace(/@@CODE_(\d+)@@/g, (_, index) => codeSegments[Number(index)] || '');
}

export function renderMarkdownPreview(markdownText) {
  const source = (markdownText || '').replace(/\r\n/g, '\n');
  if (!source.trim()) {
    return `
      <div class="markdown-preview-empty">
        No content to preview
      </div>
    `;
  }

  const lines = source.split('\n');
  const blocks = [];
  let i = 0;

  const isBlockStart = (line) => {
    const trimmed = line.trim();
    return (
      /^#{1,6}\s+/.test(trimmed) ||
      /^```/.test(trimmed) ||
      /^>\s?/.test(trimmed) ||
      /^[-*+]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      /^(?:---|\*\*\*|___)\s*$/.test(trimmed)
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```([\w-]*)\s*$/);
    if (fenceMatch) {
      const language = fenceMatch[1] || '';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(`
        <pre class="markdown-code-block"${language ? ` data-language="${escapeHtml(language)}"` : ''}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>
      `);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(?:---|\*\*\*|___)\s*$/.test(trimmed)) {
      blocks.push('<hr />');
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(`
        <blockquote>
          ${quoteLines.map((quoteLine) => `<p>${parseInlineMarkdown(quoteLine)}</p>`).join('')}
        </blockquote>
      `);
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        const match = ordered
          ? current.match(/^\d+\.\s+(.+)$/)
          : current.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }

      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`
        <${tag}>
          ${items.map((item) => `<li>${parseInlineMarkdown(item)}</li>`).join('')}
        </${tag}>
      `);
      continue;
    }

    const paragraphLines = [];
    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim() || isBlockStart(current)) break;
      paragraphLines.push(current.trim());
      i += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push(`<p>${parseInlineMarkdown(paragraphLines.join(' '))}</p>`);
      continue;
    }

    // Fallback for any line that was not consumed above.
    blocks.push(`<p>${parseInlineMarkdown(trimmed)}</p>`);
    i += 1;
  }

  return `
    <div class="markdown-preview-body">
      ${blocks.join('')}
    </div>
  `;
}

export class DiffViewer {
  constructor() {
    this.container = document.getElementById('diff-container');
    this.fileListEl = document.getElementById('diff-file-items');
    this.editorWrapper = document.getElementById('diff-editor-wrapper');
    this.previewContainer = document.getElementById('diff-markdown-preview');
    this.emptyState = document.getElementById('diff-empty-state');
    this.refreshBtn = document.getElementById('diff-refresh-btn');
    this.toolbar = document.getElementById('diff-toolbar');
    this.collapseBtn = document.getElementById('diff-toggle-collapse');
    this.sideBySideBtn = document.getElementById('diff-toggle-side-by-side');
    this.previewBtn = document.getElementById('diff-toggle-markdown-preview');

    /** @type {import('monaco-editor').editor.IStandaloneDiffEditor | null} */
    this.diffEditor = null;
    this.currentDiffData = null;
    this.selectedFilePath = null;
    this.currentFiles = [];
    this.currentFolderId = null;
    this.currentFolderPath = null;

    // Toggle state (collapse unchanged regions on by default)
    this._collapseUnchanged = true;
    this._sideBySide = true;
    this._markdownPreview = false;

    // Section collapse state — keyed by section id
    this._sectionCollapsed = { changed: false, unversioned: false };

    // Callbacks set by app.js
    this.onRefresh = null;
    this.onFileSelect = null;

    // Refresh button
    this.refreshBtn.addEventListener('click', () => {
      if (this.onRefresh) this.onRefresh();
    });

    // Collapse unchanged toggle
    this.collapseBtn.addEventListener('click', () => {
      this._collapseUnchanged = !this._collapseUnchanged;
      this.collapseBtn.classList.toggle('active', this._collapseUnchanged);
      if (this.diffEditor) {
        this.diffEditor.updateOptions({
          hideUnchangedRegions: { enabled: this._collapseUnchanged },
        });
      }
    });

    // Side-by-side / inline toggle
    this.sideBySideBtn.addEventListener('click', () => {
      this._sideBySide = !this._sideBySide;
      this.sideBySideBtn.classList.toggle('active', this._sideBySide);
      this.sideBySideBtn.querySelector('span').textContent = this._sideBySide ? 'Split' : 'Inline';
      this._syncDiffEditorOptions();
      if (this.diffEditor) {
        this.diffEditor.layout();
      }
    });

    // Markdown preview toggle
    this.previewBtn.addEventListener('click', () => {
      if (!this.currentDiffData || !this._isMarkdownFile(this.currentDiffData)) return;
      this._markdownPreview = !this._markdownPreview;
      this._syncPreviewMode();
    });

    // Resize observer to refit editor
    this._resizeObserver = new ResizeObserver(() => {
      if (this.diffEditor) {
        this.diffEditor.layout();
      }
    });
    this._resizeObserver.observe(this.editorWrapper);
  }

  /**
   * Show the diff viewer container.
   */
  show() {
    this.container.classList.remove('hidden');
  }

  /**
   * Hide the diff viewer container.
   */
  hide() {
    this.container.classList.add('hidden');
  }

  /**
   * Determine whether the current diff is a markdown file.
   * @param {{ language: string, filePath: string }} diffData
   * @returns {boolean}
   */
  _isMarkdownFile(diffData) {
    if (!diffData) return false;
    return diffData.language === 'markdown' || /\.(md|markdown)$/i.test(diffData.filePath || '');
  }

  /**
   * Apply the current diff editor options.
   */
  _syncDiffEditorOptions() {
    if (!this.diffEditor) return;
    this.diffEditor.updateOptions({
      renderSideBySide: this._sideBySide,
      useInlineViewWhenSpaceIsLimited: false,
      hideUnchangedRegions: {
        enabled: this._collapseUnchanged,
      },
    });
  }

  /**
   * Show either the diff editor or the markdown preview for the current file.
   */
  _syncPreviewMode() {
    const isMarkdown = this._isMarkdownFile(this.currentDiffData);
    const previewEnabled = isMarkdown && this._markdownPreview;

    this.previewBtn.classList.toggle('hidden', !isMarkdown);
    this.previewBtn.classList.toggle('active', previewEnabled);

    if (previewEnabled) {
      this.editorWrapper.classList.add('hidden');
      this.previewContainer.classList.remove('hidden');
      this.previewContainer.innerHTML = renderMarkdownPreview(
        this.currentDiffData?.modified || this.currentDiffData?.original || ''
      );
      return;
    }

    this.previewContainer.classList.add('hidden');
    this.previewContainer.innerHTML = '';
    this.editorWrapper.classList.remove('hidden');

    if (this.diffEditor) {
      this.diffEditor.layout();
    }
  }

  /**
   * Dispose the current diff models.
   */
  _disposeCurrentModels() {
    if (!this.diffEditor) return;
    const currentModel = this.diffEditor.getModel();
    if (currentModel) {
      if (currentModel.original) currentModel.original.dispose();
      if (currentModel.modified) currentModel.modified.dispose();
    }
  }

  /**
   * Hide the diff editor and preview panes while keeping the file list visible.
   */
  _showEmptyDiffState() {
    this.emptyState.classList.remove('hidden');
    this.editorWrapper.classList.add('hidden');
    this.previewContainer.classList.add('hidden');
    this.previewContainer.innerHTML = '';
    this.toolbar.classList.add('hidden');
    this.previewBtn.classList.add('hidden');
    this.currentDiffData = null;
    this._disposeCurrentModels();
  }

  /**
   * Render the changed files list split into "Changed" and "Unversioned" sections.
   * @param {Array<{ path: string, status: string }>} files
   * @param {string} folderId
   * @param {string} folderPath
   */
  renderFileList(files, folderId, folderPath) {
    this.currentFiles = files;
    this.currentFolderId = folderId;
    this.currentFolderPath = folderPath;
    this.fileListEl.innerHTML = '';

    if (this.selectedFilePath && !files.some((file) => file.path === this.selectedFilePath)) {
      this.selectedFilePath = null;
      this._showEmptyDiffState();
    }

    const changedFiles = files.filter((f) => f.status !== '?');
    const unversionedFiles = files.filter((f) => f.status === '?');

    if (files.length === 0) {
      this._showEmptyDiffState();
      this.fileListEl.innerHTML = `
        <div class="diff-no-files">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
            <path d="M12 16l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
          </svg>
          <p>No changes detected</p>
        </div>
      `;
      return;
    }

    if (changedFiles.length > 0) {
      this.fileListEl.appendChild(
        this._renderSection('changed', 'Changes', changedFiles)
      );
    }

    if (unversionedFiles.length > 0) {
      this.fileListEl.appendChild(
        this._renderSection('unversioned', 'Unversioned Files', unversionedFiles)
      );
    }
  }

  /**
   * Render a collapsible section of files.
   * @param {string} key - unique key for collapse state
   * @param {string} title
   * @param {Array<{ path: string, status: string }>} files
   * @returns {HTMLElement}
   */
  _renderSection(key, title, files) {
    const isCollapsed = this._sectionCollapsed[key] || false;

    const section = document.createElement('div');
    section.className = 'diff-file-section';

    // Section header
    const header = document.createElement('div');
    header.className = `diff-section-header${isCollapsed ? ' collapsed' : ''}`;
    header.innerHTML = `
      <svg class="diff-section-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M3 4.5L6 7.5 9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="diff-section-title">${title}</span>
      <span class="diff-section-count">${files.length}</span>
    `;

    // File list for this section
    const list = document.createElement('div');
    list.className = 'diff-section-files';
    if (isCollapsed) list.classList.add('hidden');

    files.forEach((file) => {
      list.appendChild(this._renderFileItem(file));
    });

    header.addEventListener('click', () => {
      this._sectionCollapsed[key] = !this._sectionCollapsed[key];
      header.classList.toggle('collapsed', this._sectionCollapsed[key]);
      list.classList.toggle('hidden', this._sectionCollapsed[key]);
    });

    section.appendChild(header);
    section.appendChild(list);
    return section;
  }

  /**
   * Render a single file item row.
   * @param {{ path: string, status: string }} file
   * @returns {HTMLElement}
   */
  _renderFileItem(file) {
    const item = document.createElement('div');
    item.className = `diff-file-item${file.path === this.selectedFilePath ? ' active' : ''}`;
    item.dataset.filePath = file.path;

    const statusClass = this._getStatusClass(file.status);
    const statusLabel = this._getStatusLabel(file.status);
    const fileName = file.path.split('/').pop();
    const fileDir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
    const statusEl = document.createElement('span');
    statusEl.className = `diff-file-status ${statusClass}`;
    statusEl.title = statusLabel;
    statusEl.textContent = file.status;

    const nameEl = document.createElement('span');
    nameEl.className = 'diff-file-name';
    nameEl.title = file.path;
    nameEl.textContent = fileName;

    item.appendChild(statusEl);
    item.appendChild(nameEl);

    if (fileDir) {
      const dirEl = document.createElement('span');
      dirEl.className = 'diff-file-dir';
      dirEl.textContent = fileDir;
      item.appendChild(dirEl);
    }

    item.addEventListener('click', () => {
      this.selectedFilePath = file.path;
      this._highlightActiveFile();
      if (this.onFileSelect) {
        this.onFileSelect(file.path, file.status);
      }
    });

    return item;
  }

  /**
   * Show a diff in the Monaco editor.
   * @param {{ original: string, modified: string, language: string, filePath: string }} diffData
   */
  async showDiff(diffData) {
    // Wait for Monaco to be ready
    const monaco = await window.monacoReady;
    const isMarkdown = this._isMarkdownFile(diffData);

    this.currentDiffData = diffData;

    this.emptyState.classList.add('hidden');
    this.toolbar.classList.remove('hidden');
    this.previewBtn.classList.toggle('hidden', !isMarkdown);

    if (!isMarkdown) {
      this._markdownPreview = false;
    }

    if (!this.diffEditor) {
      // Create the diff editor
      this.diffEditor = monaco.editor.createDiffEditor(this.editorWrapper, {
        theme: 'vs-dark',
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: this._sideBySide,
        useInlineViewWhenSpaceIsLimited: false,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        diffWordWrap: 'off',
        ignoreTrimWhitespace: false,
        glyphMargin: true,
        folding: true,
        lineNumbersMinChars: 4,
        padding: { top: 8 },
        hideUnchangedRegions: {
          enabled: true,
          revealLineCount: 3,
          minimumLineCount: 3,
          contextLineCount: 3,
        },
      });
    }

    this._syncDiffEditorOptions();

    // Create models for the diff
    const originalModel = monaco.editor.createModel(
      diffData.original,
      diffData.language,
      monaco.Uri.parse(`original:///${diffData.filePath}`)
    );

    const modifiedModel = monaco.editor.createModel(
      diffData.modified,
      diffData.language,
      monaco.Uri.parse(`modified:///${diffData.filePath}`)
    );

    // Dispose old models if any
    const currentModel = this.diffEditor.getModel();
    if (currentModel) {
      if (currentModel.original) currentModel.original.dispose();
      if (currentModel.modified) currentModel.modified.dispose();
    }

    this.diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    if (isMarkdown && this._markdownPreview) {
      this._syncPreviewMode();
    } else {
      this._markdownPreview = false;
      this.previewBtn.classList.remove('active');
      this._syncPreviewMode();
    }

    this.diffEditor.layout();
  }

  /**
   * Reset the diff viewer to empty state.
   */
  reset() {
    this.selectedFilePath = null;
    this.currentDiffData = null;
    this.emptyState.classList.remove('hidden');
    this.editorWrapper.classList.add('hidden');
    this.previewContainer.classList.add('hidden');
    this.previewContainer.innerHTML = '';
    this.toolbar.classList.add('hidden');
    this.previewBtn.classList.add('hidden');

    this._disposeCurrentModels();
  }

  /**
   * Highlight the active file in the list.
   */
  _highlightActiveFile() {
    this.fileListEl.querySelectorAll('.diff-file-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.filePath === this.selectedFilePath);
    });
  }

  _getStatusClass(status) {
    switch (status) {
      case 'M': return 'status-modified';
      case 'A': return 'status-added';
      case 'D': return 'status-deleted';
      case '?': return 'status-untracked';
      case 'R': return 'status-renamed';
      default: return 'status-other';
    }
  }

  _getStatusLabel(status) {
    switch (status) {
      case 'M': return 'Modified';
      case 'A': return 'Added';
      case 'D': return 'Deleted';
      case '?': return 'Untracked';
      case 'R': return 'Renamed';
      default: return status;
    }
  }

  /**
   * Dispose the editor when switching away.
   */
  dispose() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this.diffEditor) {
      this.diffEditor.dispose();
      this.diffEditor = null;
    }
  }
}
