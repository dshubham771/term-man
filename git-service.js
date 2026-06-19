/**
 * git-service.js
 * Wraps git CLI commands for status and diff operations.
 * No external dependencies — uses child_process.execFile directly.
 */

const { execFile } = require('child_process');
const path = require('path');

/**
 * Execute a git command and return stdout.
 * @param {string} cwd - Working directory
 * @param {string[]} args - Git arguments
 * @returns {Promise<string>} stdout
 */
function gitExec(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // git diff returns exit code 1 when there are diffs — that's fine
        if (error.code === 1 && args[0] === 'diff') {
          resolve(stdout);
          return;
        }
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Check if a directory is inside a git repository.
 * @param {string} cwd
 * @returns {Promise<boolean>}
 */
async function isGitRepo(cwd) {
  try {
    await gitExec(cwd, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name.
 * @param {string} cwd
 * @returns {Promise<string|null>}
 */
async function getGitBranch(cwd) {
  try {
    const branch = await gitExec(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return branch.trim();
  } catch {
    return null;
  }
}

/**
 * Get git status — list of changed files with status codes.
 * @param {string} cwd
 * @returns {Promise<{ branch: string|null, files: Array<{ path: string, status: string, staged: boolean }> }>}
 */
async function getGitStatus(cwd) {
  const isRepo = await isGitRepo(cwd);
  if (!isRepo) {
    return { branch: null, files: [], isRepo: false };
  }

  const branch = await getGitBranch(cwd);

  // Use porcelain v1 format for stable parsing
  const output = await gitExec(cwd, ['status', '--porcelain', '-u']);

  const files = [];
  const lines = output.split('\n').filter((l) => l.length > 0);

  for (const line of lines) {
    const indexStatus = line[0]; // staged status
    const workTreeStatus = line[1]; // unstaged status
    const filePath = line.substring(3).trim();

    // Handle renamed files (format: "R  old -> new")
    let displayPath = filePath;
    if (filePath.includes(' -> ')) {
      displayPath = filePath.split(' -> ')[1];
    }

    // Determine the most relevant status to show
    let status;
    if (indexStatus === '?' || workTreeStatus === '?') {
      status = '?'; // Untracked
    } else if (indexStatus === 'A' || workTreeStatus === 'A') {
      status = 'A'; // Added
    } else if (indexStatus === 'D' || workTreeStatus === 'D') {
      status = 'D'; // Deleted
    } else if (indexStatus === 'R' || workTreeStatus === 'R') {
      status = 'R'; // Renamed
    } else if (indexStatus === 'M' || workTreeStatus === 'M') {
      status = 'M'; // Modified
    } else {
      status = indexStatus !== ' ' ? indexStatus : workTreeStatus;
    }

    files.push({
      path: displayPath,
      status,
      staged: indexStatus !== ' ' && indexStatus !== '?',
    });
  }

  return { branch, files, isRepo: true };
}

/**
 * Get the original (HEAD) content of a file.
 * @param {string} cwd
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function getOriginalContent(cwd, filePath) {
  try {
    return await gitExec(cwd, ['show', `HEAD:${filePath}`]);
  } catch {
    return ''; // New file — no original content
  }
}

/**
 * Get the current (working tree) content of a file.
 * @param {string} cwd
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function getModifiedContent(cwd, filePath) {
  const fs = require('fs');
  const fullPath = path.join(cwd, filePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return ''; // Deleted file — no current content
  }
}

/**
 * Get diff data for a specific file — both original and modified content.
 * @param {string} cwd
 * @param {string} filePath
 * @param {string} fileStatus - The status code (M/A/D/?)
 * @returns {Promise<{ original: string, modified: string, language: string }>}
 */
async function getFileDiff(cwd, filePath, fileStatus) {
  let original = '';
  let modified = '';

  if (fileStatus === 'D') {
    // Deleted file — only original exists
    original = await getOriginalContent(cwd, filePath);
  } else if (fileStatus === 'A' || fileStatus === '?') {
    // New/untracked file — only modified exists
    modified = await getModifiedContent(cwd, filePath);
  } else {
    // Modified — both exist
    [original, modified] = await Promise.all([
      getOriginalContent(cwd, filePath),
      getModifiedContent(cwd, filePath),
    ]);
  }

  // Detect language from file extension
  const language = getLanguageFromPath(filePath);

  return { original, modified, language, filePath };
}

/**
 * Map file extension to Monaco language ID.
 */
function getLanguageFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.json': 'json',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.py': 'python',
    '.rb': 'ruby',
    '.java': 'java',
    '.kt': 'kotlin',
    '.go': 'go',
    '.rs': 'rust',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.sql': 'sql',
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.dockerfile': 'dockerfile',
    '.graphql': 'graphql',
    '.vue': 'html',
    '.svelte': 'html',
    '.toml': 'ini',
    '.ini': 'ini',
    '.env': 'ini',
    '.properties': 'ini',
  };
  return map[ext] || 'plaintext';
}

module.exports = {
  isGitRepo,
  getGitBranch,
  getGitStatus,
  getFileDiff,
};
