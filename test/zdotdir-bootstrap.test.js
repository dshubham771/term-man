const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ZDOTDIR = path.join(__dirname, '..', 'shell', 'zdotdir');

describe('zdotdir bootstrap', () => {
  it('sets ZSH_COMPDUMP under ~/.terminal-manager in .zshenv', () => {
    const zshenv = fs.readFileSync(path.join(ZDOTDIR, '.zshenv'), 'utf-8');
    assert.match(zshenv, /TM_STATE_DIR=.*\.terminal-manager/);
    assert.match(zshenv, /ZSH_COMPDUMP=.*TM_STATE_DIR/);
    assert.match(zshenv, /mkdir -p/);
  });

  it('does not ship generated zcompdump files in zdotdir', () => {
    const names = fs.readdirSync(ZDOTDIR);
    for (const name of names) {
      const generated =
        name.startsWith('.zcompdump') || name.endsWith('.zwc');
      assert.equal(generated, false, `unexpected ${name}`);
    }
  });

  it('includes required bootstrap dotfiles', () => {
    for (const file of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
      assert.ok(fs.existsSync(path.join(ZDOTDIR, file)), `missing ${file}`);
    }
  });
});
