const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  addCommandEntry,
  getPrefixMatches,
  getGhostSuffix,
  normalizeLoadedEntries,
} = require('./lib/command-history');

const STATE_DIR = path.join(os.homedir(), '.terminal-manager');
const HISTORY_FILE = path.join(STATE_DIR, 'command-history.json');

class CommandHistoryStore {
  constructor() {
    /** @type {import('./lib/command-history').CommandEntry[]} */
    this._entries = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        this._entries = normalizeLoadedEntries(raw.commands ?? raw);
      }
    } catch (error) {
      console.error('Failed to load command history:', error);
      this._entries = [];
    }
  }

  _save() {
    try {
      if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
      }
      fs.writeFileSync(
        HISTORY_FILE,
        JSON.stringify({ commands: this._entries }, null, 2),
        'utf-8',
      );
    } catch (error) {
      console.error('Failed to save command history:', error);
    }
  }

  /**
   * @returns {import('./lib/command-history').CommandEntry[]}
   */
  getEntries() {
    return this._entries;
  }

  /**
   * @param {string} command
   */
  add(command) {
    const beforeLen = this._entries.length;
    const beforeTop = this._entries[0]?.command;
    this._entries = addCommandEntry(this._entries, command);
    if (
      this._entries.length !== beforeLen ||
      this._entries[0]?.command !== beforeTop
    ) {
      this._save();
    }
  }

  /**
   * @param {string} prefix
   * @returns {string[]}
   */
  getPrefixMatches(prefix) {
    return getPrefixMatches(this._entries, prefix);
  }

  /**
   * @param {string} prefix
   * @returns {string|null}
   */
  getGhostSuffix(prefix) {
    return getGhostSuffix(this._entries, prefix);
  }
}

module.exports = { CommandHistoryStore, HISTORY_FILE };
