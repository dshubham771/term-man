/** @typedef {{ command: string, usedAt: number }} CommandEntry */

const MAX_COMMANDS = 200;

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function shouldStoreCommand(cmd) {
  if (!cmd || !cmd.trim()) return false;
  if (cmd.startsWith(' ')) return false;
  return true;
}

/**
 * @param {CommandEntry[]} entries
 * @param {string} command
 * @param {number} [now]
 * @returns {CommandEntry[]}
 */
function addCommandEntry(entries, command, now = Date.now()) {
  if (!shouldStoreCommand(command)) return entries;

  const trimmed = command.trim();
  const withoutDup = entries.filter((e) => e.command !== trimmed);
  const next = [{ command: trimmed, usedAt: now }, ...withoutDup];
  return next.slice(0, MAX_COMMANDS);
}

/**
 * Commands that start with prefix, most recent first.
 * @param {CommandEntry[]} entries
 * @param {string} prefix
 * @returns {string[]}
 */
function getPrefixMatches(entries, prefix) {
  if (!prefix) return [];
  return entries
    .filter((e) => e.command.startsWith(prefix))
    .sort((a, b) => b.usedAt - a.usedAt)
    .map((e) => e.command);
}

/**
 * Ghost suffix for the best (most recent) prefix match.
 * @param {CommandEntry[]} entries
 * @param {string} prefix
 * @returns {string|null}
 */
function getGhostSuffix(entries, prefix) {
  if (!prefix) return null;
  const matches = getPrefixMatches(entries, prefix);
  if (matches.length === 0) return null;
  const best = matches[0];
  if (!best.startsWith(prefix) || best.length <= prefix.length) return null;
  return best.slice(prefix.length);
}

/**
 * @param {unknown} data
 * @returns {CommandEntry[]}
 */
function normalizeLoadedEntries(data) {
  const list = Array.isArray(data) ? data : data?.commands;
  if (!Array.isArray(list)) return [];
  const entries = [];
  for (const item of list) {
    if (typeof item === 'string' && shouldStoreCommand(item)) {
      entries.push({ command: item.trim(), usedAt: Date.now() });
      continue;
    }
    if (item && typeof item === 'object' && typeof item.command === 'string') {
      const command = item.command.trim();
      if (!shouldStoreCommand(command)) continue;
      const usedAt = typeof item.usedAt === 'number' ? item.usedAt : Date.now();
      entries.push({ command, usedAt });
    }
  }
  return entries.slice(0, MAX_COMMANDS);
}

module.exports = {
  MAX_COMMANDS,
  shouldStoreCommand,
  addCommandEntry,
  getPrefixMatches,
  getGhostSuffix,
  normalizeLoadedEntries,
};
