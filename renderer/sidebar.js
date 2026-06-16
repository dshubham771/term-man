/**
 * sidebar.js
 * Manages the sidebar UI: folder groups, terminal tabs, and user interactions.
 */

const HOVER_TOOLTIP_DELAY_MS = 250;
const TAG_COLORS = [
  { name: 'Blue', value: '#58a6ff' },
  { name: 'Green', value: '#3fb950' },
  { name: 'Yellow', value: '#d29922' },
  { name: 'Red', value: '#f85149' },
  { name: 'Purple', value: '#bc8cff' },
  { name: 'Orange', value: '#f0883e' },
];

export class Sidebar {
  /**
   * @param {object} callbacks
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.folderListEl = document.getElementById('folder-list');
    this.sortButtonEl = document.getElementById('sidebar-sort-btn');
    /** @type {boolean} Skip sidebar re-renders while a tab name is being edited */
    this._isRenaming = false;
    this._tooltipTimer = null;
    this._tooltipAnchor = null;
    this._dragState = null;
    this._lastState = null;

    this._tooltipEl = document.createElement('div');
    this._tooltipEl.className = 'sidebar-hover-tooltip';
    this._tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(this._tooltipEl);

    if (this.sortButtonEl) {
      this.sortButtonEl.addEventListener('click', (event) => {
        event.stopPropagation();
        if (this._sortMenuEl) {
          this._dismissSortMenu();
          return;
        }
        this._showSortMenu();
      });
    }
  }

  _cancelHoverTooltip() {
    if (this._tooltipTimer) {
      clearTimeout(this._tooltipTimer);
      this._tooltipTimer = null;
    }
    this._tooltipAnchor = null;
    this._tooltipEl.classList.remove('visible');
  }

  /**
   * @param {HTMLElement} el
   * @param {string} text
   */
  _bindHoverTooltip(el, text) {
    if (!el || !text) return;

    el.addEventListener('mouseenter', () => {
      this._scheduleHoverTooltip(el, text);
    });
    el.addEventListener('mouseleave', () => this._cancelHoverTooltip());
    el.addEventListener('mousedown', () => this._cancelHoverTooltip());
  }

  /**
   * @param {HTMLElement} el
   * @param {string} text
   */
  _scheduleHoverTooltip(el, text) {
    this._cancelHoverTooltip();
    this._tooltipAnchor = el;

    this._tooltipTimer = setTimeout(() => {
      this._tooltipTimer = null;
      if (this._tooltipAnchor !== el || !el.matches(':hover')) return;
      if (el.scrollWidth <= el.clientWidth) return;

      this._tooltipEl.textContent = text;
      this._positionHoverTooltip(el);
    }, HOVER_TOOLTIP_DELAY_MS);
  }

  /** @param {HTMLElement} anchor */
  _positionHoverTooltip(anchor) {
    const rect = anchor.getBoundingClientRect();
    const margin = 6;
    const tip = this._tooltipEl;

    tip.style.maxWidth = `${Math.max(160, rect.width + 80)}px`;
    tip.style.left = '-9999px';
    tip.style.top = '0';
    tip.classList.add('visible');

    const tipRect = tip.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + margin;

    if (left + tipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tipRect.width - 8;
    }
    if (left < 8) left = 8;

    if (top + tipRect.height > window.innerHeight - 8) {
      top = rect.top - tipRect.height - margin;
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  _hasBlockingOverlay() {
    return Boolean(this._isRenaming || this._activeContextMenu || this._sortMenuEl);
  }

  _syncSortButtonState() {
    if (!this.sortButtonEl) return;
    this.sortButtonEl.classList.toggle('active', Boolean(this._sortMenuEl));
  }

  /**
   * Render the sidebar from state.
   * @param {object} state
   */
  render(state) {
    this._lastState = state;
    this._syncSortButtonState();

    if (this._isRenaming) return;

    const { folders, activeTerminalId } = state;

    this.folderListEl.innerHTML = '';

    if (folders.length === 0) {
      this.folderListEl.innerHTML = `
        <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 12px; line-height: 1.5;">
          No folders added yet.<br/>Click "Add Folder" below to get started.
        </div>
      `;
      return;
    }

    folders.forEach((folder) => {
      const groupEl = this._createFolderGroup(folder, activeTerminalId);
      this.folderListEl.appendChild(groupEl);
    });
  }

  /**
   * @param {number} fromIndex
   * @param {number} targetIndex
   * @param {'above'|'below'} placement
   * @returns {number}
   */
  _getDropIndex(fromIndex, targetIndex, placement) {
    if (placement === 'below') {
      return fromIndex < targetIndex ? targetIndex : targetIndex + 1;
    }
    return fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  }

  /**
   * @param {DragEvent} event
   * @param {HTMLElement} element
   */
  _getDropPlacement(event, element) {
    const rect = element.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
  }

  /**
   * @param {HTMLElement} element
   * @param {'above'|'below'} placement
   */
  _applyDropIndicator(element, placement) {
    element.classList.toggle('drag-over-above', placement === 'above');
    element.classList.toggle('drag-over-below', placement === 'below');
  }

  /**
   * @param {HTMLElement} element
   */
  _clearDropIndicator(element) {
    element.classList.remove('drag-over-above', 'drag-over-below');
  }

  /**
   * Create a folder group element.
   */
  _createFolderGroup(folder, activeTerminalId) {
    const group = document.createElement('div');
    group.className = `folder-group${folder.collapsed ? ' collapsed' : ''}`;
    group.dataset.folderId = folder.id;

    const gitInfo = folder.gitInfo;
    const showBranch = gitInfo && gitInfo.isRepo && gitInfo.branch;

    const headerBar = document.createElement('div');
    headerBar.className = 'folder-header-bar';
    if (folder.tagColor) {
      headerBar.classList.add('tagged');
      headerBar.style.setProperty('--item-tag-color', folder.tagColor);
    }

    const gitRowHtml = showBranch
      ? `
      <div class="folder-git-row">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="3" cy="3" r="1.5" stroke="currentColor" stroke-width="1"/>
          <circle cx="3" cy="9" r="1.5" stroke="currentColor" stroke-width="1"/>
          <circle cx="9" cy="3" r="1.5" stroke="currentColor" stroke-width="1"/>
          <path d="M3 4.5V7.5M4.5 3H7.5" stroke="currentColor" stroke-width="1"/>
        </svg>
        <span class="folder-branch-name">${gitInfo.branch}</span>
      </div>`
      : '';

    headerBar.innerHTML = `
      <div class="folder-header-top">
        <button class="folder-drag-handle" type="button" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="3" cy="3" r="1" fill="currentColor"/>
            <circle cx="3" cy="6" r="1" fill="currentColor"/>
            <circle cx="3" cy="9" r="1" fill="currentColor"/>
            <circle cx="8" cy="3" r="1" fill="currentColor"/>
            <circle cx="8" cy="6" r="1" fill="currentColor"/>
            <circle cx="8" cy="9" r="1" fill="currentColor"/>
          </svg>
        </button>
        <svg class="folder-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M5 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="folder-icon" aria-hidden="true">📁</span>
        <span class="folder-name">${folder.name}</span>
      </div>
      ${gitRowHtml}
      <div class="folder-actions">
        <button class="folder-action-btn new-term-action" title="New Terminal" type="button">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="folder-action-btn danger remove-folder-action" title="Remove Folder" type="button">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;

    headerBar.addEventListener('click', (event) => {
      if (event.target.closest('.folder-action-btn, .folder-drag-handle')) return;
      this.callbacks.onToggleFolderCollapsed(folder.id);
    });

    headerBar.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._showFolderContextMenu(event.clientX, event.clientY, folder);
    });

    headerBar.querySelector('.new-term-action').addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onNewTerminal(folder.id);
    });

    headerBar.querySelector('.remove-folder-action').addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onRemoveFolder(folder.id);
    });

    const folderDragHandle = headerBar.querySelector('.folder-drag-handle');
    folderDragHandle.draggable = true;
    folderDragHandle.addEventListener('dragstart', (event) => {
      if (this._hasBlockingOverlay()) {
        event.preventDefault();
        return;
      }
      this._dismissSortMenu();
      this._dismissContextMenu();
      this._dragState = { type: 'folder', folderId: folder.id };
      group.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', folder.id);
    });

    headerBar.addEventListener('dragover', (event) => {
      if (!this._dragState || this._dragState.type !== 'folder') return;
      event.preventDefault();
      this._applyDropIndicator(group, this._getDropPlacement(event, headerBar));
    });

    headerBar.addEventListener('dragleave', (event) => {
      if (!group.contains(event.relatedTarget)) {
        this._clearDropIndicator(group);
      }
    });

    headerBar.addEventListener('drop', (event) => {
      if (!this._dragState || this._dragState.type !== 'folder') return;
      event.preventDefault();
      const folders = this._lastState?.folders || [];
      const fromIndex = folders.findIndex((item) => item.id === this._dragState.folderId);
      const targetIndex = folders.findIndex((item) => item.id === folder.id);
      const placement = this._getDropPlacement(event, headerBar);
      const toIndex = this._getDropIndex(fromIndex, targetIndex, placement);
      this._clearDropIndicator(group);
      if (fromIndex !== -1 && toIndex !== fromIndex) {
        this.callbacks.onReorderFolders(this._dragState.folderId, folder.id, placement);
      }
    });

    folderDragHandle.addEventListener('dragend', () => {
      group.classList.remove('dragging');
      this._clearDropIndicator(group);
      this._dragState = null;
    });

    group.appendChild(headerBar);

    const folderNameEl = headerBar.querySelector('.folder-name');
    this._bindHoverTooltip(folderNameEl, folder.name);

    const branchNameEl = headerBar.querySelector('.folder-branch-name');
    if (branchNameEl && gitInfo?.branch) {
      this._bindHoverTooltip(branchNameEl, gitInfo.branch);
    }

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'terminal-tabs';

    folder.terminals.forEach((term) => {
      const tab = this._createTerminalTab(folder, term, activeTerminalId);
      tabsContainer.appendChild(tab);
    });

    const newTermBtn = document.createElement('button');
    newTermBtn.className = 'new-terminal-btn';
    newTermBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>New Terminal</span>
    `;
    newTermBtn.addEventListener('click', () => {
      this.callbacks.onNewTerminal(folder.id);
    });
    tabsContainer.appendChild(newTermBtn);

    group.appendChild(tabsContainer);

    return group;
  }

  /**
   * Create a terminal tab element.
   */
  _createTerminalTab(folder, term, activeTerminalId) {
    const tab = document.createElement('div');
    tab.className = `terminal-tab${term.id === activeTerminalId ? ' active' : ''}`;
    tab.dataset.terminalId = term.id;
    if (term.tagColor) {
      tab.classList.add('tagged');
      tab.style.setProperty('--item-tag-color', term.tagColor);
    }

    tab.innerHTML = `
      <button class="terminal-drag-handle" type="button" title="Drag to reorder">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="3" cy="3" r="1" fill="currentColor"/>
          <circle cx="3" cy="6" r="1" fill="currentColor"/>
          <circle cx="3" cy="9" r="1" fill="currentColor"/>
          <circle cx="8" cy="3" r="1" fill="currentColor"/>
          <circle cx="8" cy="6" r="1" fill="currentColor"/>
          <circle cx="8" cy="9" r="1" fill="currentColor"/>
        </svg>
      </button>
      <svg class="terminal-tab-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M3.5 5.5l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 9.5h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      <span class="terminal-tab-name">${term.name}</span>
      <button class="terminal-tab-close" title="Close Terminal" type="button">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    tab.addEventListener('click', (event) => {
      if (event.target.closest('.terminal-tab-close, .terminal-drag-handle')) return;
      if (event.target.closest('.terminal-tab-rename-input')) return;
      this.callbacks.onSelectTerminal(folder.id, term.id);
    });

    tab.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._showTerminalContextMenu(event.clientX, event.clientY, folder, term, tab);
    });

    tab.querySelector('.terminal-tab-close').addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onCloseTerminal(folder.id, term.id);
    });

    const terminalDragHandle = tab.querySelector('.terminal-drag-handle');
    terminalDragHandle.draggable = true;
    terminalDragHandle.addEventListener('dragstart', (event) => {
      if (this._hasBlockingOverlay()) {
        event.preventDefault();
        return;
      }
      this._dismissSortMenu();
      this._dismissContextMenu();
      this._dragState = { type: 'terminal', folderId: folder.id, terminalId: term.id };
      tab.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', term.id);
    });

    tab.addEventListener('dragover', (event) => {
      if (!this._dragState || this._dragState.type !== 'terminal') return;
      if (this._dragState.folderId !== folder.id) return;
      event.preventDefault();
      this._applyDropIndicator(tab, this._getDropPlacement(event, tab));
    });

    tab.addEventListener('dragleave', (event) => {
      if (!tab.contains(event.relatedTarget)) {
        this._clearDropIndicator(tab);
      }
    });

    tab.addEventListener('drop', (event) => {
      if (!this._dragState || this._dragState.type !== 'terminal') return;
      if (this._dragState.folderId !== folder.id) return;
      event.preventDefault();
      const terminals = folder.terminals || [];
      const fromIndex = terminals.findIndex((item) => item.id === this._dragState.terminalId);
      const targetIndex = terminals.findIndex((item) => item.id === term.id);
      const placement = this._getDropPlacement(event, tab);
      const toIndex = this._getDropIndex(fromIndex, targetIndex, placement);
      this._clearDropIndicator(tab);
      if (fromIndex !== -1 && toIndex !== fromIndex) {
        this.callbacks.onReorderTerminals(folder.id, this._dragState.terminalId, term.id, placement);
      }
    });

    terminalDragHandle.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      this._clearDropIndicator(tab);
      this._dragState = null;
    });

    return tab;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  _positionMenu(menu, x, y) {
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);

    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        menu.style.left = `${Math.max(8, x - rect.width)}px`;
      }
      if (rect.bottom > window.innerHeight - 8) {
        menu.style.top = `${Math.max(8, y - rect.height)}px`;
      }
    });
  }

  _showSortMenu() {
    if (!this._lastState || !this.sortButtonEl) return;
    this._dismissContextMenu();
    this._dismissSortMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu sidebar-sort-menu';
    menu.innerHTML = `
      <div class="context-menu-section-label">Folders</div>
      ${this._buildSortMenuItem('folder-sort-addedTime', 'Added time', this._lastState.folderSortMode === 'addedTime')}
      ${this._buildSortMenuItem('folder-sort-name', 'Name', this._lastState.folderSortMode === 'name')}
      ${this._buildSortMenuItem('folder-sort-custom', 'Manual', this._lastState.folderSortMode === 'custom', true)}
      <div class="context-menu-divider"></div>
      <div class="context-menu-section-label">Terminals</div>
      ${this._buildSortMenuItem('terminal-sort-addedTime', 'Added time', this._lastState.terminalSortMode === 'addedTime')}
      ${this._buildSortMenuItem('terminal-sort-name', 'Name', this._lastState.terminalSortMode === 'name')}
      ${this._buildSortMenuItem('terminal-sort-custom', 'Manual', this._lastState.terminalSortMode === 'custom', true)}
    `;

    const rect = this.sortButtonEl.getBoundingClientRect();
    this._positionMenu(menu, rect.right - 12, rect.bottom + 6);

    menu.querySelector('[data-action="folder-sort-addedTime"]').addEventListener('click', () => {
      this.callbacks.onSetFolderSortMode('addedTime');
      this._dismissSortMenu();
    });
    menu.querySelector('[data-action="folder-sort-name"]').addEventListener('click', () => {
      this.callbacks.onSetFolderSortMode('name');
      this._dismissSortMenu();
    });
    menu.querySelector('[data-action="terminal-sort-addedTime"]').addEventListener('click', () => {
      this.callbacks.onSetTerminalSortMode('addedTime');
      this._dismissSortMenu();
    });
    menu.querySelector('[data-action="terminal-sort-name"]').addEventListener('click', () => {
      this.callbacks.onSetTerminalSortMode('name');
      this._dismissSortMenu();
    });

    const dismissHandler = (event) => {
      if (!menu.contains(event.target) && !this.sortButtonEl.contains(event.target)) {
        this._dismissSortMenu();
      }
    };
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        this._dismissSortMenu();
      }
    };

    this._sortMenuEl = menu;
    this._sortMenuDismissHandler = dismissHandler;
    this._sortMenuEscHandler = escHandler;
    this._syncSortButtonState();

    setTimeout(() => {
      document.addEventListener('click', dismissHandler, true);
      document.addEventListener('contextmenu', dismissHandler, true);
      document.addEventListener('keydown', escHandler);
    }, 0);
  }

  _buildSortMenuItem(action, label, checked, disabled = false) {
    return `
      <button class="context-menu-item${disabled ? ' disabled' : ''}" data-action="${action}" ${disabled ? 'disabled' : ''}>
        <span class="context-menu-check">${checked ? '✓' : ''}</span>
        <span>${label}</span>
      </button>
    `;
  }

  _dismissSortMenu() {
    if (this._sortMenuEl) {
      this._sortMenuEl.remove();
      this._sortMenuEl = null;
    }
    if (this._sortMenuDismissHandler) {
      document.removeEventListener('click', this._sortMenuDismissHandler, true);
      document.removeEventListener('contextmenu', this._sortMenuDismissHandler, true);
      this._sortMenuDismissHandler = null;
    }
    if (this._sortMenuEscHandler) {
      document.removeEventListener('keydown', this._sortMenuEscHandler);
      this._sortMenuEscHandler = null;
    }
    this._syncSortButtonState();
  }

  _buildTagControlsHtml(currentColor) {
    const swatches = TAG_COLORS.map((color) => `
      <button
        class="color-swatch${currentColor === color.value ? ' active' : ''}"
        type="button"
        title="${color.name}"
        data-color="${color.value}"
        style="--swatch-color: ${color.value};"
      ></button>
    `).join('');

    return `
      <div class="context-menu-divider"></div>
      <div class="context-menu-section-label">Set color</div>
      <div class="color-swatch-row">${swatches}</div>
      <button class="context-menu-item" data-action="clear-color">
        <span class="context-menu-check">${currentColor ? '' : '✓'}</span>
        <span>Clear color</span>
      </button>
    `;
  }

  _showFolderContextMenu(x, y, folder) {
    this._dismissSortMenu();
    this._dismissContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = this._buildTagControlsHtml(folder.tagColor);
    this._positionMenu(menu, x, y);

    menu.querySelectorAll('[data-color]').forEach((button) => {
      button.addEventListener('click', () => {
        this.callbacks.onSetFolderTagColor(folder.id, button.dataset.color);
        this._dismissContextMenu();
      });
    });

    menu.querySelector('[data-action="clear-color"]').addEventListener('click', () => {
      this.callbacks.onSetFolderTagColor(folder.id, null);
      this._dismissContextMenu();
    });

    this._activateContextMenu(menu);
  }

  _showTerminalContextMenu(x, y, folder, term, tab) {
    this._dismissSortMenu();
    this._dismissContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
      ${this._buildTagControlsHtml(term.tagColor)}
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" data-action="rename">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Rename
      </button>
      <button class="context-menu-item" data-action="clear">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 2h10M2 5h10M2 8h7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M11 8l-2 4M9 8l2 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        Clear
      </button>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item danger" data-action="close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        Close Terminal
      </button>
    `;
    this._positionMenu(menu, x, y);

    menu.querySelectorAll('[data-color]').forEach((button) => {
      button.addEventListener('click', () => {
        this.callbacks.onSetTerminalTagColor(folder.id, term.id, button.dataset.color);
        this._dismissContextMenu();
      });
    });

    menu.querySelector('[data-action="clear-color"]').addEventListener('click', () => {
      this.callbacks.onSetTerminalTagColor(folder.id, term.id, null);
      this._dismissContextMenu();
    });

    menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
      this._dismissContextMenu();
      this._startRenaming(tab, folder, term);
    });

    menu.querySelector('[data-action="clear"]').addEventListener('click', () => {
      this._dismissContextMenu();
      this.callbacks.onClearTerminal(folder.id, term.id);
    });

    menu.querySelector('[data-action="close"]').addEventListener('click', () => {
      this._dismissContextMenu();
      this.callbacks.onCloseTerminal(folder.id, term.id);
    });

    this._activateContextMenu(menu);
  }

  _activateContextMenu(menu) {
    const dismissHandler = (event) => {
      if (!menu.contains(event.target)) {
        this._dismissContextMenu();
      }
    };

    const escHandler = (event) => {
      if (event.key === 'Escape') {
        this._dismissContextMenu();
      }
    };

    this._activeContextMenu = menu;
    this._contextMenuDismissHandler = dismissHandler;
    this._contextMenuEscHandler = escHandler;

    setTimeout(() => {
      document.addEventListener('click', dismissHandler, true);
      document.addEventListener('contextmenu', dismissHandler, true);
      document.addEventListener('keydown', escHandler);
    }, 0);
  }

  _dismissContextMenu() {
    if (this._activeContextMenu) {
      this._activeContextMenu.remove();
      this._activeContextMenu = null;
    }
    if (this._contextMenuDismissHandler) {
      document.removeEventListener('click', this._contextMenuDismissHandler, true);
      document.removeEventListener('contextmenu', this._contextMenuDismissHandler, true);
      this._contextMenuDismissHandler = null;
    }
    if (this._contextMenuEscHandler) {
      document.removeEventListener('keydown', this._contextMenuEscHandler);
      this._contextMenuEscHandler = null;
    }
  }

  /**
   * Start inline renaming of a terminal tab.
   */
  _startRenaming(tab, folder, term) {
    const nameEl = tab.querySelector('.terminal-tab-name');
    if (!nameEl) return;

    this._isRenaming = true;

    const currentName = term.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'terminal-tab-rename-input';
    input.value = currentName;

    nameEl.style.display = 'none';
    nameEl.parentNode.insertBefore(input, nameEl.nextSibling);

    input.focus();
    input.select();

    let finished = false;

    const cleanup = () => {
      this._isRenaming = false;
      input.remove();
      nameEl.style.display = '';
    };

    const commit = () => {
      if (finished) return;
      finished = true;

      const newName = input.value.trim();
      cleanup();

      if (newName && newName !== currentName) {
        this.callbacks.onRenameTerminal(folder.id, term.id, newName);
      }
    };

    const cancel = () => {
      if (finished) return;
      finished = true;
      cleanup();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
      event.stopPropagation();
    });

    input.addEventListener('blur', () => {
      commit();
    });

    input.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }
}
