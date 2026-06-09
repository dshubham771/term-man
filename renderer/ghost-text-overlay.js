/**
 * Inline ghost-text overlay positioned after the xterm cursor.
 */
export class GhostTextOverlay {
  /**
   * @param {HTMLElement} terminalElement
   * @param {import('@xterm/xterm').Terminal} terminal
   */
  constructor(terminalElement, terminal) {
    this.terminal = terminal;
    this.el = document.createElement('span');
    this.el.className = 'terminal-ghost-text';
    this.el.setAttribute('aria-hidden', 'true');
    terminalElement.style.position = 'relative';
    terminalElement.appendChild(this.el);
    this._suffix = '';
  }

  /**
   * @param {string} suffix
   */
  setSuffix(suffix) {
    this._suffix = suffix || '';
    this.el.textContent = this._suffix;
    this.el.style.display = this._suffix ? 'block' : 'none';
    if (this._suffix) {
      this._position();
    }
  }

  hide() {
    this.setSuffix('');
  }

  _position() {
    const term = this.terminal;
    const buffer = term.buffer.active;
    const cursorX = buffer.cursorX;
    const cursorY = buffer.cursorY;

    const fontSize = term.options.fontSize || 13;
    const lineHeightFactor = typeof term.options.lineHeight === 'number' ? term.options.lineHeight : 1.4;
    const cellWidth = fontSize * 0.6;
    const lineHeight = fontSize * lineHeightFactor;

    this.el.style.fontFamily = term.options.fontFamily || 'monospace';
    this.el.style.fontSize = `${fontSize}px`;
    this.el.style.lineHeight = String(lineHeightFactor);

    const viewport = term.element?.querySelector('.xterm-screen');
    const paddingTop = viewport ? 0 : 0;

    this.el.style.left = `${cursorX * cellWidth + 4}px`;
    this.el.style.top = `${cursorY * lineHeight + paddingTop}px`;
  }

  reposition() {
    if (this._suffix) this._position();
  }

  dispose() {
    this.el.remove();
  }
}
