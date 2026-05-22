const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  isZsh,
  getZshIntegrationSpawn,
  getPtySpawnOptions,
} = require('../lib/pty-spawn');

const ROOT = path.join(__dirname, '..');
const ZDOTDIR = path.join(ROOT, 'shell', 'zdotdir');
const INTEGRATION = path.join(ROOT, 'shell', 'tm-zsh-integration.zsh');

describe('pty-spawn', () => {
  it('detects zsh by basename', () => {
    assert.equal(isZsh('/bin/zsh'), true);
    assert.equal(isZsh('/bin/bash'), false);
  });

  it('uses login shell with ZDOTDIR, not a script argument', () => {
    const opts = getZshIntegrationSpawn('/bin/zsh', {
      zdotdir: ZDOTDIR,
      integration: INTEGRATION,
    });
    assert.ok(opts);
    assert.deepEqual(opts.args, ['-l']);
    assert.ok(opts.env.ZDOTDIR);
    assert.ok(opts.env.TM_ZSH_INTEGRATION);
    assert.equal(opts.args.includes('--rcs'), false);
  });

  it('falls back when integration paths are missing', () => {
    const opts = getPtySpawnOptions('/bin/zsh', {
      zdotdir: '/nonexistent',
      integration: '/nonexistent',
    });
    assert.deepEqual(opts.args, []);
    assert.equal(opts.env.ZDOTDIR, undefined);
  });

  it('merges zsh integration env into base env', () => {
    const opts = getPtySpawnOptions(
      '/bin/zsh',
      { zdotdir: ZDOTDIR, integration: INTEGRATION },
      { FOO: 'bar' },
    );
    assert.equal(opts.env.FOO, 'bar');
    assert.equal(opts.env.TERM, 'xterm-256color');
    assert.equal(path.basename(opts.env.ZDOTDIR), 'zdotdir');
  });
});
