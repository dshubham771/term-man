/**
 * claude-status.js
 * Manages the Claude Code status bar: detects running sessions, shows the
 * current model (read from ~/.claude/settings.json with live file-watch), and
 * lets the user change model / thinking effort via dropdown menus.
 */

const CLAUDE_MODELS = [
  { id: 'opus',   label: 'Claude Opus',   description: 'Most capable'  },
  { id: 'sonnet', label: 'Claude Sonnet', description: 'Fast & capable' },
  { id: 'haiku',  label: 'Claude Haiku',  description: 'Fastest'        },
];

const EFFORT_LEVELS = [
  { id: 'default',    label: 'Default',    command: null,          description: 'Standard mode'     },
  { id: 'think',      label: 'Think',      command: '/think',      description: 'Extended thinking' },
  { id: 'ultrathink', label: 'Ultrathink', command: '/ultrathink', description: 'Maximum thinking'  },
];

/** Extract a display name from whatever string Claude Code stores as the model. */
function parseFriendlyModelName(raw) {
  if (!raw) return null;
  // Strip bracket suffixes like [1m], [200k], etc.
  const base = raw.replace(/\[.*?\]/g, '').trim().toLowerCase();
  if (base.includes('opus'))   return 'Opus';
  if (base.includes('sonnet')) return 'Sonnet';
  if (base.includes('haiku'))  return 'Haiku';
  // Capitalise whatever is left
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export class ClaudeStatusBar {
  /**
   * @param {{ getActiveTerminalId: () => string|null }} opts
   */
  constructor({ getActiveTerminalId }) {
    this.getActiveTerminalId = getActiveTerminalId;
    this.currentModel  = null;
    this.currentEffort = 'default';
    this.isRunning     = false;
    this.openDropdown  = null;   // 'model' | 'effort' | null
    this._pollInterval = null;

    this._bindElements();
    this._bindEvents();
    this._start();
  }

  // ─── Setup ──────────────────────────────────────────────

  _bindElements() {
    this.bar            = document.getElementById('claude-status-bar');
    this.indicator      = document.getElementById('claude-indicator');
    this.indicatorLabel = document.getElementById('claude-indicator-label');
    this.modelChip      = document.getElementById('claude-model-chip');
    this.modelLabel     = document.getElementById('claude-model-label');
    this.effortChip     = document.getElementById('claude-effort-chip');
    this.effortLabel    = document.getElementById('claude-effort-label');
  }

  _bindEvents() {
    this.modelChip.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleDropdown('model');
    });

    this.effortChip.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleDropdown('effort');
    });

    // Close dropdown when clicking anywhere else
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#status-dropdown')) {
        this._closeDropdown();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closeDropdown();
    });
  }

  async _start() {
    // Load initial model from ~/.claude/settings.json
    try {
      const status = await window.terminalAPI.claudeGetStatus();
      this.currentModel = status.model;
      this._updateModelDisplay();
    } catch (e) {
      console.error('[claude-status] Failed to load initial status:', e);
    }

    // Watch settings file for external changes (e.g. user types /model inside claude)
    try {
      await window.terminalAPI.claudeStartWatching();
      window.terminalAPI.onClaudeSettingsChanged((settings) => {
        if (settings.model !== this.currentModel) {
          this.currentModel = settings.model;
          this._updateModelDisplay();
        }
      });
    } catch (e) {
      console.error('[claude-status] Failed to start settings watcher:', e);
    }

    // Poll process list every 3 s to update the "active" indicator
    this._pollRunningStatus();
    this._pollInterval = setInterval(() => this._pollRunningStatus(), 3000);
  }

  // ─── Polling / updates ──────────────────────────────────

  async _pollRunningStatus() {
    try {
      const running = await window.terminalAPI.claudeIsRunning();
      if (running !== this.isRunning) {
        this.isRunning = running;
        this._updateRunningIndicator();
      }
    } catch (_) {
      // Ignore transient errors
    }
  }

  _updateModelDisplay() {
    const friendly = parseFriendlyModelName(this.currentModel);
    this.modelLabel.textContent = friendly || '–';
  }

  _updateEffortDisplay() {
    const effort = EFFORT_LEVELS.find((e) => e.id === this.currentEffort);
    this.effortLabel.textContent = effort ? effort.label : 'Default';
  }

  _updateRunningIndicator() {
    if (this.isRunning) {
      this.indicator.classList.add('running');
      this.indicatorLabel.textContent = 'Claude Code · Active';
    } else {
      this.indicator.classList.remove('running');
      this.indicatorLabel.textContent = 'Claude Code';
    }
  }

  // ─── Dropdown logic ─────────────────────────────────────

  _toggleDropdown(type) {
    if (this.openDropdown === type) {
      this._closeDropdown();
      return;
    }
    this._closeDropdown();
    this.openDropdown = type;

    if (type === 'model')  this._showModelDropdown();
    if (type === 'effort') this._showEffortDropdown();
  }

  _showModelDropdown() {
    const currentBase = this.currentModel
      ? this.currentModel.replace(/\[.*?\]/g, '').trim().toLowerCase()
      : null;

    const items = CLAUDE_MODELS.map((m) => ({
      id:          m.id,
      label:       m.label,
      description: m.description,
      active:      !!currentBase && (currentBase === m.id || currentBase.includes(m.id)),
    }));

    this._showDropdown(this.modelChip, items, (id) => this._applyModel(id));
  }

  _showEffortDropdown() {
    const items = EFFORT_LEVELS.map((e) => ({
      id:          e.id,
      label:       e.label,
      description: e.description,
      active:      this.currentEffort === e.id,
    }));

    this._showDropdown(this.effortChip, items, (id) => this._applyEffort(id));
  }

  _showDropdown(anchorEl, items, onSelect) {
    const existing = document.getElementById('status-dropdown');
    if (existing) existing.remove();

    const dropdown = document.createElement('div');
    dropdown.id        = 'status-dropdown';
    dropdown.className = 'status-dropdown';

    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = `status-dropdown-item${item.active ? ' active' : ''}`;
      btn.innerHTML  = `
        <span class="dropdown-item-check">${item.active ? '✓' : ''}</span>
        <span class="dropdown-item-text">
          <span class="dropdown-item-label">${item.label}</span>
          ${item.description ? `<span class="dropdown-item-desc">${item.description}</span>` : ''}
        </span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeDropdown();
        onSelect(item.id);
      });
      dropdown.appendChild(btn);
    });

    document.body.appendChild(dropdown);

    // Position above the anchor chip
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.right  = `${window.innerWidth - rect.right}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  }

  _closeDropdown() {
    this.openDropdown = null;
    const el = document.getElementById('status-dropdown');
    if (el) el.remove();
  }

  // ─── Apply changes ──────────────────────────────────────

  async _applyModel(modelId) {
    try {
      await window.terminalAPI.claudeSetModel(modelId);
      this.currentModel = modelId;
      this._updateModelDisplay();

      // If claude is running, also push the change into the active terminal session
      if (this.isRunning) {
        const activeId = this.getActiveTerminalId();
        if (activeId) {
          await window.terminalAPI.claudeSendToTerminal(activeId, `/model ${modelId}`);
        }
      }
    } catch (e) {
      console.error('[claude-status] Failed to apply model:', e);
    }
  }

  async _applyEffort(effortId) {
    const effort = EFFORT_LEVELS.find((e) => e.id === effortId);
    if (!effort) return;

    this.currentEffort = effortId;
    this._updateEffortDisplay();

    // Send effort command to the active terminal if claude is running there
    if (this.isRunning && effort.command) {
      const activeId = this.getActiveTerminalId();
      if (activeId) {
        try {
          await window.terminalAPI.claudeSendToTerminal(activeId, effort.command);
        } catch (e) {
          console.error('[claude-status] Failed to send effort command:', e);
        }
      }
    }
  }

  // ─── Cleanup ────────────────────────────────────────────

  destroy() {
    if (this._pollInterval) clearInterval(this._pollInterval);
    this._closeDropdown();
  }
}
