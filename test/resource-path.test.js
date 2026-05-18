const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { getResourcePath } = require('../lib/resource-path');

describe('resource-path', () => {
  it('uses app dir in development', () => {
    const appDir = '/project';
    const result = getResourcePath(appDir, false, '/Resources', 'shell', 'zdotdir');
    assert.equal(result, path.join(appDir, 'shell', 'zdotdir'));
  });

  it('uses app.asar.unpacked when packaged', () => {
    const result = getResourcePath(
      '/app.asar',
      true,
      '/Applications/Terminal Manager.app/Contents/Resources',
      'shell',
      'tm-zsh-integration.zsh',
    );
    assert.equal(
      result,
      path.join(
        '/Applications/Terminal Manager.app/Contents/Resources',
        'app.asar.unpacked',
        'shell',
        'tm-zsh-integration.zsh',
      ),
    );
  });
});
