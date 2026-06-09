const KEY = {
  ENTER: '\r',
  TAB: '\t',
  BS: '\x7f',
  BS_ALT: '\b',
  CTRL_C: '\x03',
  CTRL_U: '\x15',
  ESC: '\x1b',
};

/**
 * @param {string} data
 * @returns {{ type: string, seq?: string }}
 */
function parseKey(data) {
  if (data === KEY.ENTER) return { type: 'enter' };
  if (data === KEY.TAB) return { type: 'tab' };
  if (data === KEY.BS || data === KEY.BS_ALT) return { type: 'backspace' };
  if (data === KEY.CTRL_C) return { type: 'ctrl_c' };
  if (data === KEY.CTRL_U) return { type: 'ctrl_u' };
  if (data === '\x1b[A') return { type: 'up' };
  if (data === '\x1b[B') return { type: 'down' };
  if (data === '\x1b[C') return { type: 'right' };
  if (data === '\x1b[D') return { type: 'left' };
  if (data.length === 1 && data >= ' ' && data <= '~') return { type: 'printable', char: data };
  return { type: 'other', data };
}

/**
 * Tracks the current prompt line typed by the user (best-effort).
 */
class TerminalLineBuffer {
  constructor() {
    this.line = '';
    this.historyIndex = -1;
  }

  reset() {
    this.line = '';
    this.historyIndex = -1;
  }

  /**
   * @param {string} char
   */
  append(char) {
    this.line += char;
    this.historyIndex = -1;
  }

  backspace() {
    if (this.line.length > 0) {
      this.line = this.line.slice(0, -1);
    }
    this.historyIndex = -1;
  }

  clearLine() {
    this.line = '';
    this.historyIndex = -1;
  }

  /**
   * @param {string} text
   */
  setLine(text) {
    this.line = text;
  }
}

module.exports = {
  KEY,
  parseKey,
  TerminalLineBuffer,
};
