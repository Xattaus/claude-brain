import { readdir, stat } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', 'target', 'bin', 'obj', '.brain', '.claude',
  'coverage', '.nyc_output', '.cache', 'graphify-out'
]);

const LANGUAGE_MAP = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.rb': 'ruby', '.cs': 'csharp', '.kt': 'kotlin', '.kts': 'kotlin', '.php': 'php',
};

export async function scanFiles(rootPath, options = {}) {
  const results = [];
  const maxDepth = options.maxDepth || 20;

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const language = LANGUAGE_MAP[ext];
        if (!language) continue;

        let fileStat;
        try { fileStat = await stat(fullPath); } catch { continue; }
        if (fileStat.size > 1_000_000) continue;

        const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');
        results.push({
          absolutePath: fullPath,
          relativePath,
          language,
          size: fileStat.size,
          mtime: fileStat.mtime,
        });
      }
    }
  }

  await walk(rootPath, 0);
  return results;
}

export function getSupportedLanguages() {
  return [...new Set(Object.values(LANGUAGE_MAP))];
}
