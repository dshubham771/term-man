const SORT_MODES = Object.freeze({
  ADDED_TIME: 'addedTime',
  NAME: 'name',
  CUSTOM: 'custom',
});

/**
 * @template T
 * @param {T[]} items
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {T[]}
 */
function moveItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items)) return [];
  if (fromIndex === toIndex) return items.slice();
  if (fromIndex < 0 || toIndex < 0) return items.slice();
  if (fromIndex >= items.length || toIndex >= items.length) return items.slice();

  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} getName
 * @returns {T[]}
 */
function sortByName(items, getName) {
  return items.slice().sort((a, b) =>
    getName(a).localeCompare(getName(b), undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  );
}

/**
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
function sortByCreatedAt(items) {
  return items.slice().sort((a, b) => {
    const left = typeof a?.createdAt === 'number' ? a.createdAt : 0;
    const right = typeof b?.createdAt === 'number' ? b.createdAt : 0;
    return left - right;
  });
}

/**
 * @param {Array<{ name: string, createdAt?: number }>} folders
 * @param {string} mode
 * @returns {Array<{ name: string, createdAt?: number }>}
 */
function sortFolders(folders, mode) {
  if (!Array.isArray(folders)) return [];
  if (mode === SORT_MODES.NAME) return sortByName(folders, (folder) => folder.name || '');
  if (mode === SORT_MODES.ADDED_TIME) return sortByCreatedAt(folders);
  return folders.slice();
}

/**
 * @param {Array<{ name: string, createdAt?: number }>} terminals
 * @param {string} mode
 * @returns {Array<{ name: string, createdAt?: number }>}
 */
function sortTerminals(terminals, mode) {
  if (!Array.isArray(terminals)) return [];
  if (mode === SORT_MODES.NAME) return sortByName(terminals, (term) => term.name || '');
  if (mode === SORT_MODES.ADDED_TIME) return sortByCreatedAt(terminals);
  return terminals.slice();
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} [now]
 * @returns {(T & { createdAt: number })[]}
 */
function ensureCreatedAt(items, now = Date.now()) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => ({
    ...item,
    createdAt: typeof item?.createdAt === 'number' ? item.createdAt : now + index,
  }));
}

module.exports = {
  SORT_MODES,
  ensureCreatedAt,
  moveItem,
  sortFolders,
  sortTerminals,
};
