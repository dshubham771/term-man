const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  addCommandEntry,
  getPrefixMatches,
  getGhostSuffix,
  shouldStoreCommand,
  MAX_COMMANDS,
  normalizeLoadedEntries,
} = require('../lib/command-history');

describe('command-history', () => {
  it('skips blank and leading-space commands', () => {
    assert.equal(shouldStoreCommand(''), false);
    assert.equal(shouldStoreCommand('   '), false);
    assert.equal(shouldStoreCommand(' secret'), false);
    assert.equal(shouldStoreCommand('ls'), true);
  });

  it('stores recent commands with dedupe', () => {
    let entries = [];
    entries = addCommandEntry(entries, 'git pull');
    entries = addCommandEntry(entries, 'git push');
    entries = addCommandEntry(entries, 'git pull');
    assert.deepEqual(
      entries.map((e) => e.command),
      ['git pull', 'git push'],
    );
  });

  it('caps at MAX_COMMANDS', () => {
    let entries = [];
    for (let i = 0; i < MAX_COMMANDS + 5; i += 1) {
      entries = addCommandEntry(entries, `cmd-${i}`);
    }
    assert.equal(entries.length, MAX_COMMANDS);
    assert.equal(entries[0].command, `cmd-${MAX_COMMANDS + 4}`);
  });

  it('returns prefix matches most-recent first', () => {
    const entries = [
      { command: 'git pull', usedAt: 100 },
      { command: 'git push origin main', usedAt: 200 },
      { command: 'npm test', usedAt: 300 },
    ];
    const matches = getPrefixMatches(entries, 'git pu');
    assert.deepEqual(matches, ['git push origin main', 'git pull']);
  });

  it('returns ghost suffix from best match', () => {
    const entries = [
      { command: 'git pull', usedAt: 100 },
      { command: 'git push origin main', usedAt: 200 },
    ];
    assert.equal(getGhostSuffix(entries, 'git pu'), 'sh origin main');
    assert.equal(getGhostSuffix(entries, 'npm'), null);
  });

  it('normalizes legacy string arrays', () => {
    const entries = normalizeLoadedEntries({ commands: ['ls', '  ', ' pwd'] });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].command, 'ls');
  });
});
