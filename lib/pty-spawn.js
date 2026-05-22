const fs = require('fs');
const path = require('path');

function isZsh(shellPath) {
  return path.basename(shellPath) === 'zsh';
}

/**
 * Build PTY spawn options for zsh with app integration via ZDOTDIR.
 * Does not modify files in the user's home directory.
 *
 * @param {string} shell
 * @param {{ zdotdir: string, integration: string }} paths
 * @returns {{ shell: string, args: string[], env: Record<string, string> } | null}
 */
function getZshIntegrationSpawn(shell, paths) {
  if (!isZsh(shell)) return null;
  if (!fs.existsSync(paths.zdotdir) || !fs.existsSync(paths.integration)) {
    return null;
  }

  return {
    shell,
    args: ['-l'],
    env: {
      ZDOTDIR: paths.zdotdir,
      TM_ZSH_INTEGRATION: paths.integration,
    },
  };
}

/**
 * @param {string} shell
 * @param {{ zdotdir?: string, integration?: string }} [paths]
 * @param {Record<string, string>} [baseEnv]
 */
function getPtySpawnOptions(shell, paths = {}, baseEnv = {}) {
  const env = {
    ...baseEnv,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };

  const zsh = getZshIntegrationSpawn(shell, {
    zdotdir: paths.zdotdir || '',
    integration: paths.integration || '',
  });

  if (zsh) {
    return {
      shell: zsh.shell,
      args: zsh.args,
      env: { ...env, ...zsh.env },
    };
  }

  return { shell, args: [], env };
}

module.exports = {
  isZsh,
  getZshIntegrationSpawn,
  getPtySpawnOptions,
};
