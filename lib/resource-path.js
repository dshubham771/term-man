const path = require('path');
const fs = require('fs');

/**
 * Resolve a path to app resources that must be readable by external processes (e.g. zsh).
 * Packaged builds store these under app.asar.unpacked, not inside the asar archive.
 *
 * @param {string} appDir - __dirname from main process
 * @param {boolean} isPackaged - app.isPackaged
 * @param {string} resourcesPath - process.resourcesPath when packaged
 * @param {...string} segments
 * @returns {string}
 */
function getResourcePath(appDir, isPackaged, resourcesPath, ...segments) {
  const relative = path.join(...segments);
  if (isPackaged) {
    return path.join(resourcesPath, 'app.asar.unpacked', relative);
  }
  return path.join(appDir, relative);
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isUsableShellResource(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

module.exports = {
  getResourcePath,
  isUsableShellResource,
};
