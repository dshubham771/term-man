const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SORT_MODES,
  ensureCreatedAt,
  moveItem,
  sortFolders,
  sortTerminals,
} = require('../lib/sidebar-order');

describe('sidebar-order', () => {
  it('sorts folders by name', () => {
    const folders = [
      { id: '2', name: 'zeta', createdAt: 2 },
      { id: '1', name: 'Alpha', createdAt: 1 },
    ];

    assert.deepEqual(
      sortFolders(folders, SORT_MODES.NAME).map((folder) => folder.id),
      ['1', '2'],
    );
  });

  it('sorts terminals by added time', () => {
    const terminals = [
      { id: '2', name: 'Terminal 2', createdAt: 20 },
      { id: '1', name: 'Terminal 1', createdAt: 10 },
    ];

    assert.deepEqual(
      sortTerminals(terminals, SORT_MODES.ADDED_TIME).map((terminal) => terminal.id),
      ['1', '2'],
    );
  });

  it('preserves order in custom mode', () => {
    const folders = [
      { id: 'a', name: 'beta', createdAt: 2 },
      { id: 'b', name: 'alpha', createdAt: 1 },
    ];

    assert.deepEqual(
      sortFolders(folders, SORT_MODES.CUSTOM).map((folder) => folder.id),
      ['a', 'b'],
    );
  });

  it('moves items to a new index', () => {
    const items = ['a', 'b', 'c', 'd'];
    assert.deepEqual(moveItem(items, 1, 3), ['a', 'c', 'd', 'b']);
    assert.deepEqual(items, ['a', 'b', 'c', 'd']);
  });

  it('assigns monotonic createdAt values to legacy items', () => {
    const items = ensureCreatedAt(
      [
        { id: '1', name: 'One' },
        { id: '2', name: 'Two' },
        { id: '3', name: 'Three' },
      ],
      5000,
    );

    assert.deepEqual(
      items.map((item) => item.createdAt),
      [5000, 5001, 5002],
    );
  });
});
