/**
 * terminal-manager.js
 * Manages xterm.js terminal instances and their connection to PTY processes.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { FEATURE_FLAGS } from './feature-flags.js';
import { GhostTextOverlay } from './ghost-text-overlay.js';
import { SmartTerminalInput } from './smart-terminal-input.js';

const SMART_COMMAND_UI_ENABLED = FEATURE_FLAGS.smartCommandUI;

export class TerminalManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.terminals = new Map();
    this.container = document.getElementById('terminal-container');
    this.activeTerminalId = null;
    /** @type {import('../lib/command-history.js').CommandEntry[]} */
    this.commandHistory = [];

    if (SMART_COMMAND_UI_ENABLED) {
      this._loadCommandHistory();

      window.terminalAPI.onCommandHistoryUpdated(({ entries }) => {
        this.commandHistory = entries || [];
        this._refreshSmartInputForAll();
      });
    }

    window.terminalAPI.onPtyData(({ id, data }) => {
      const entry = this.terminals.get(id);
      if (entry) {
        entry.terminal.write(data);
        entry.smartInput?.onTerminalWrite();
      }
    });

    if (SMART_COMMAND_UI_ENABLED) {
      window.terminalAPI.onPtyMeta(({ id, atPrompt, alternateScreen }) => {
        const entry = this.terminals.get(id);
        if (!entry) return;
        if (atPrompt) {
          entry.smartInput?.setAtPrompt(true);
        }
        if (typeof alternateScreen === 'boolean') {
          entry.alternateScreen = alternateScreen;
          entry.smartInput?.setAlternateScreen(alternateScreen);
        }
      });
    }

    window.terminalAPI.onPtyExit(({ id, exitCode }) => {
      const entry = this.terminals.get(id);
      if (entry) {
        entry.terminal.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    });

    window.addEventListener('resize', () => {
      this._refitActiveTerminal();
    });

    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this._containerResizeObserver = new ResizeObserver(() => {
        this._refitActiveTerminal();
      });
      this._containerResizeObserver.observe(this.container);
    }
  }

  async _loadCommandHistory() {
    try {
      const entries = await window.terminalAPI.getCommandHistory();
      this.commandHistory = entries || [];
    } catch (e) {
      console.error('Failed to load command history:', e);
    }
  }

  _refreshSmartInputForAll() {
    if (!SMART_COMMAND_UI_ENABLED) return;
    for (const entry of this.terminals.values()) {
      entry.smartInput?.refreshSuggestions?.();
    }
  }

  /**
   * @param {string} id
   * @param {string} cwd
   * @returns {Promise<boolean>}
   */
  async createTerminal(id, cwd) {
    const terminal = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: 'rgba(88, 166, 255, 0.3)',
        selectionForeground: '#e6edf3',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d364',
        brightWhite: '#f0f6fc',
      },
      fontFamily: "'Meslo LG M for Powerline', 'Meslo LG S for Powerline', 'MesloLGS NF', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);

    const element = document.createElement('div');
    element.className = 'terminal-instance';
    element.id = `terminal-${id}`;
    this.container.appendChild(element);

    terminal.open(element);

    const ghostOverlay = SMART_COMMAND_UI_ENABLED
      ? new GhostTextOverlay(element, terminal)
      : null;

    const entry = {
      terminal,
      fitAddon,
      searchAddon,
      element,
      shellPid: null,
      alternateScreen: false,
      ghostOverlay,
      smartInput: null,
    };

    let smartInput = null;
    if (SMART_COMMAND_UI_ENABLED && ghostOverlay) {
      smartInput = new SmartTerminalInput({
        getEntries: () => this.commandHistory,
        writeToPty: (data) => window.terminalAPI.writePty(id, data),
        ghostOverlay,
        isEnabled: () => !entry.alternateScreen,
        onStateChange: () => smartInput.refreshSuggestions(),
      });
      entry.smartInput = smartInput;
    }

    this.terminals.set(id, entry);

    try {
      fitAddon.fit();
    } catch (e) {
      // Element might not be visible yet
    }

    const cols = terminal.cols || 80;
    const rows = terminal.rows || 24;

    const result = await window.terminalAPI.createPty(id, cwd);
    if (!result.success) {
      console.error('Failed to create PTY:', result.error);
      ghostOverlay?.dispose();
      element.remove();
      this.terminals.delete(id);
      return false;
    }

    if (result.pid) {
      entry.shellPid = result.pid;
    }

    await window.terminalAPI.resizePty(id, cols, rows);

    terminal.onData((data) => {
      if (smartInput) {
        smartInput.handleData(data);
      } else {
        window.terminalAPI.writePty(id, data);
      }
    });

    terminal.onResize(() => {
      window.terminalAPI.resizePty(id, terminal.cols, terminal.rows);
      smartInput?.onResize();
    });

    return true;
  }

  showTerminal(id) {
    for (const [, entry] of this.terminals) {
      entry.element.classList.remove('active');
    }

    const entry = this.terminals.get(id);
    if (entry) {
      entry.element.classList.add('active');
      this.activeTerminalId = id;

      requestAnimationFrame(() => {
        try {
          entry.fitAddon.fit();
        } catch (e) {
          // Ignore fit errors
        }
        entry.terminal.focus();
        entry.smartInput?.onResize();
      });
    }
  }

  async destroyTerminal(id) {
    const entry = this.terminals.get(id);
    if (entry) {
      await window.terminalAPI.killPty(id);
      entry.ghostOverlay?.dispose();
      entry.terminal.dispose();
      entry.element.remove();
      this.terminals.delete(id);

      if (this.activeTerminalId === id) {
        this.activeTerminalId = null;
      }
    }
  }

  _refitActiveTerminal() {
    if (this.activeTerminalId) {
      const entry = this.terminals.get(this.activeTerminalId);
      if (entry) {
        try {
          entry.fitAddon.fit();
        } catch (e) {
          // Ignore
        }
        entry.smartInput?.onResize();
      }
    }
  }

  refitAll() {
    this._refitActiveTerminal();
  }

  clearTerminal(id) {
    const entry = this.terminals.get(id);
    if (entry) {
      entry.terminal.clear();
    }
  }

  getShellPid(id) {
    const entry = this.terminals.get(id);
    return entry?.shellPid ?? null;
  }

  searchNext(query, options = {}) {
    if (!this.activeTerminalId) return false;
    const entry = this.terminals.get(this.activeTerminalId);
    if (!entry) return false;
    return entry.searchAddon.findNext(query, {
      regex: false,
      wholeWord: false,
      caseSensitive: false,
      incremental: false,
      ...options,
    });
  }

  searchPrevious(query, options = {}) {
    if (!this.activeTerminalId) return false;
    const entry = this.terminals.get(this.activeTerminalId);
    if (!entry) return false;
    return entry.searchAddon.findPrevious(query, {
      regex: false,
      wholeWord: false,
      caseSensitive: false,
      ...options,
    });
  }

  writeResumeHint(id, message) {
    const entry = this.terminals.get(id);
    if (!entry || !message) return;

    entry.terminal.write(`\r\n\x1b[90m${message}\x1b[0m\r\n\r\n`);
  }
}
