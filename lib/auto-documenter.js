import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * AutoDocumenter — Git-based automatic documentation suggestions.
 * Analyzes recent commits to find undocumented changes that should be recorded in brain.
 */
export class AutoDocumenter {
  constructor(brainManager) {
    this.manager = brainManager;
  }

  /**
   * Analyze recent git commits and suggest brain entries for undocumented changes.
   * @param {string} [since='7 days ago'] - Git ref or date range
   * @param {boolean} [dryRun=true] - If true, only show suggestions without creating entries
   * @returns {{ suggestions: Array<{type, title, files, commitMessage, sha}>, existing: number }}
   */
  async analyze(since = '7 days ago', dryRun = true) {
    const commits = await this._getRecentCommits(since);
    if (commits.length === 0) {
      return { suggestions: [], existing: 0 };
    }

    // Get all existing entries for comparison
    const index = await this.manager.loadIndex();
    const existingFiles = new Set();
    for (const entry of index.entries) {
      if (entry.files) {
        for (const f of entry.files) {
          existingFiles.add(this.manager.normalizePath(f));
        }
      }
    }

    const suggestions = [];
    let existing = 0;

    for (const commit of commits) {
      // Check if any of the commit's files are already documented
      const undocumentedFiles = commit.files.filter(f =>
        !existingFiles.has(this.manager.normalizePath(f))
      );

      if (undocumentedFiles.length === 0) {
        existing++;
        continue;
      }

      const entryType = this._inferEntryType(commit.message);
      suggestions.push({
        type: entryType,
        title: this._extractTitle(commit.message),
        files: undocumentedFiles,
        commitMessage: commit.message,
        sha: commit.sha
      });
    }

    // Deduplicate by similar files
    const deduplicated = this._deduplicateSuggestions(suggestions);

    if (!dryRun) {
      // Create entries for each suggestion
      for (const suggestion of deduplicated) {
        await this._createEntry(suggestion);
      }
    }

    return { suggestions: deduplicated, existing };
  }

  /**
   * Get recent commits with their changed files
   */
  async _getRecentCommits(since) {
    try {
      const { stdout } = await execFileAsync('git', [
        'log',
        `--since=${since}`,
        '--name-only',
        '--pretty=format:COMMIT:%H|%s',
        '--no-merges'
      ], { cwd: this.manager.projectPath, maxBuffer: 1024 * 1024 });

      const commits = [];
      let current = null;

      for (const line of stdout.split('\n')) {
        if (line.startsWith('COMMIT:')) {
          if (current) commits.push(current);
          const [sha, ...messageParts] = line.substring(7).split('|');
          current = {
            sha: sha.trim(),
            message: messageParts.join('|').trim(),
            files: []
          };
        } else if (line.trim() && current) {
          // Skip .brain/ files and other non-code files
          const trimmed = line.trim();
          if (!trimmed.startsWith('.brain/') &&
              !trimmed.startsWith('node_modules/') &&
              !trimmed.endsWith('.lock') &&
              !trimmed.endsWith('.json') || trimmed === 'package.json') {
            current.files.push(trimmed);
          }
        }
      }
      if (current) commits.push(current);

      return commits.filter(c => c.files.length > 0);
    } catch (err) {
      process.stderr.write(`[brain] Warning: Could not read git log: ${err.message}\n`);
      return [];
    }
  }

  /**
   * Infer entry type from commit message
   */
  _inferEntryType(message) {
    const lower = message.toLowerCase();
    if (/\bfix(e[sd])?\b|\bbug\b|\bhotfix\b/.test(lower)) return 'bug';
    if (/\brefactor\b|\bredesign\b|\bmigrat\b|\bdecid\b|\bchos\b/.test(lower)) return 'decision';
    if (/\bpattern\b|\bconvention\b|\bstandard\b/.test(lower)) return 'pattern';
    return 'implementation';
  }

  /**
   * Extract a clean title from commit message
   */
  _extractTitle(message) {
    // Remove conventional commit prefix
    let title = message.replace(/^(feat|fix|refactor|chore|docs|test|ci|build|perf|style)(\(.+?\))?:\s*/i, '');
    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);
    // Truncate
    return title.length > 100 ? title.substring(0, 97) + '...' : title;
  }

  /**
   * Deduplicate suggestions that share many files
   */
  _deduplicateSuggestions(suggestions) {
    if (suggestions.length <= 1) return suggestions;

    const result = [];
    const used = new Set();

    for (let i = 0; i < suggestions.length; i++) {
      if (used.has(i)) continue;

      const current = { ...suggestions[i], files: [...suggestions[i].files] };

      // Merge with similar suggestions (same type, overlapping files)
      for (let j = i + 1; j < suggestions.length; j++) {
        if (used.has(j)) continue;
        if (suggestions[j].type !== current.type) continue;

        const overlap = suggestions[j].files.filter(f => current.files.includes(f));
        if (overlap.length > 0 || suggestions[j].files.length === 0) {
          // Merge files
          for (const f of suggestions[j].files) {
            if (!current.files.includes(f)) current.files.push(f);
          }
          used.add(j);
        }
      }

      result.push(current);
    }

    return result;
  }

  /**
   * Create a brain entry from a suggestion
   */
  async _createEntry(suggestion) {
    const typeConfig = {
      bug: { prefix: 'BUG', dirName: 'bugs', status: 'fixed' },
      decision: { prefix: 'DEC', dirName: 'decisions', status: 'active' },
      implementation: { prefix: 'IMPL', dirName: 'implementations', status: 'current' },
      pattern: { prefix: 'PAT', dirName: 'patterns', status: 'active' }
    };

    const config = typeConfig[suggestion.type] || typeConfig.implementation;
    const body = `## Auto-documented from git\n\nCommit: ${suggestion.sha}\nMessage: ${suggestion.commitMessage}\n\n## Details\n\n_Fill in details about this change._\n`;

    await this.manager.createEntry({
      type: suggestion.type,
      prefix: config.prefix,
      dirName: config.dirName,
      title: suggestion.title,
      frontmatter: {
        status: config.status,
        tags: ['auto-documented'],
        files: suggestion.files,
        related: []
      },
      body
    });
  }
}
