import { parseKey, TerminalLineBuffer, KEY } from '../lib/terminal-input.js';
import { getGhostSuffix, getPrefixMatches } from '../lib/command-history.js';

/**
 * Intercepts xterm input for ghost completion and prefix history cycling.
 */
export class SmartTerminalInput {
  /**
   * @param {object} options
   * @param {() => import('../lib/command-history.js').CommandEntry[]} options.getEntries
   * @param {(data: string) => void} options.writeToPty
   * @param {import('./ghost-text-overlay.js').GhostTextOverlay} options.ghostOverlay
   * @param {() => boolean} options.isEnabled
   * @param {() => void} [options.onStateChange]
   */
  constructor({ getEntries, writeToPty, ghostOverlay, isEnabled, onStateChange }) {
    this.getEntries = getEntries;
    this.writeToPty = writeToPty;
    this.ghostOverlay = ghostOverlay;
    this.isEnabled = isEnabled;
    this.onStateChange = onStateChange || (() => {});

    this.buffer = new TerminalLineBuffer();
    this._ghostSuffix = '';
    this._atPrompt = false;
  }

  setAtPrompt(value) {
    this._atPrompt = !!value;
    if (value) {
      this.buffer.reset();
      this._clearGhost();
    }
    this.onStateChange();
  }

  setAlternateScreen(active) {
    if (active) {
      this.buffer.reset();
      this._clearGhost();
    }
    this.onStateChange();
  }

  /**
   * @param {string} data
   * @returns {boolean} true if handled (not forwarded)
   */
  handleData(data) {
    if (!this.isEnabled() || !this._atPrompt) {
      this.writeToPty(data);
      return false;
    }

    const key = parseKey(data);

    if (key.type === 'enter') {
      this.writeToPty(KEY.ENTER);
      this.buffer.reset();
      this._clearGhost();
      this._atPrompt = false;
      return false;
    }

    if (key.type === 'ctrl_c') {
      this.writeToPty(data);
      this.buffer.reset();
      this._clearGhost();
      return false;
    }

    if (key.type === 'ctrl_u') {
      this.writeToPty(data);
      this.buffer.clearLine();
      this._updateGhost();
      return false;
    }

    if (key.type === 'tab' && this._ghostSuffix) {
      this._acceptGhost();
      return true;
    }

    if (key.type === 'right' && this._ghostSuffix) {
      this._acceptGhost();
      return true;
    }

    if (key.type === 'up') {
      const prefix = this.buffer.line;
      if (!prefix) {
        this.writeToPty(data);
        return false;
      }
      const matches = getPrefixMatches(this.getEntries(), prefix);
      if (matches.length === 0) {
        this.writeToPty(data);
        return false;
      }

      if (this.buffer.historyIndex < 0) {
        this.buffer.historyIndex = 0;
      } else if (this.buffer.historyIndex < matches.length - 1) {
        this.buffer.historyIndex += 1;
      } else {
        this.writeToPty(data);
        return false;
      }

      const next = matches[this.buffer.historyIndex];
      this._replaceLine(next);
      return true;
    }

    if (key.type === 'down' && this.buffer.historyIndex >= 0) {
      const prefix = this.buffer.line;
      const matches = getPrefixMatches(this.getEntries(), prefix);
      if (this.buffer.historyIndex > 0) {
        this.buffer.historyIndex -= 1;
        this._replaceLine(matches[this.buffer.historyIndex]);
      } else {
        this.buffer.historyIndex = -1;
        this._replaceLine(prefix);
      }
      return true;
    }

    if (key.type === 'backspace') {
      this.writeToPty(data);
      this.buffer.backspace();
      this._updateGhost();
      return false;
    }

    if (key.type === 'printable') {
      this.writeToPty(data);
      this.buffer.append(key.char);
      this._updateGhost();
      return false;
    }

    // Other keys (arrows without history, escape sequences): forward and invalidate ghost
    if (key.type === 'other' || key.type === 'left' || key.type === 'down') {
      this.writeToPty(data);
      if (key.type === 'other') {
        this.buffer.historyIndex = -1;
        this._clearGhost();
      }
      return false;
    }

    this.writeToPty(data);
    return false;
  }

  _acceptGhost() {
    if (!this._ghostSuffix) return;
    this.writeToPty(this._ghostSuffix);
    this.buffer.setLine(this.buffer.line + this._ghostSuffix);
    this._clearGhost();
    this._updateGhost();
  }

  /**
   * @param {string} line
   */
  _replaceLine(line) {
    this.writeToPty(KEY.CTRL_U);
    if (line) {
      this.writeToPty(line);
    }
    this.buffer.setLine(line);
    this._updateGhost();
  }

  _updateGhost() {
    const prefix = this.buffer.line;
    const suffix = getGhostSuffix(this.getEntries(), prefix);
    this._ghostSuffix = suffix || '';
    if (this._ghostSuffix && this.isEnabled() && this._atPrompt) {
      this.ghostOverlay.setSuffix(this._ghostSuffix);
    } else {
      this._clearGhost();
    }
  }

  _clearGhost() {
    this._ghostSuffix = '';
    this.ghostOverlay.hide();
  }

  refreshSuggestions() {
    this._updateGhost();
  }

  onTerminalWrite() {
    this.ghostOverlay.reposition();
  }

  onResize() {
    this.ghostOverlay.reposition();
  }
}
