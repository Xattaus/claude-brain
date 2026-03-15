/**
 * Conversation Miner — Louhii Claude Code -keskustelulokeista kontekstin
 *
 * Lukee ~/.claude/projects/ -hakemistosta JSONL-keskustelulokeja,
 * korreloi ne tiedostopolkujen ja aikaleimien kanssa, ja palauttaa
 * relevantin kontekstin (miksi muutoksia tehtiin).
 */

import { readFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

// ── Project path → conversation directory mapping ──

function projectPathToDirectoryName(projectPath) {
  const normalized = projectPath.replace(/\//g, '\\');
  return normalized
    .replace(':', '')
    .replace(/\\/g, '-')
    .replace(/ /g, '-');
}

async function resolveConversationDirs(projectPath) {
  const claudeProjectsDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(claudeProjectsDir)) return [];

  const expectedName = projectPathToDirectoryName(projectPath);
  const dirs = await readdir(claudeProjectsDir);
  const results = [];
  const normalizedProject = projectPath.replace(/\//g, '\\').toLowerCase();

  // 1. Case-insensitive exact match
  const match = dirs.find(d => d.toLowerCase() === expectedName.toLowerCase());
  if (match) results.push(join(claudeProjectsDir, match));

  // 2. Scan sessions-index.json for originalPath match or parent path match
  for (const dir of dirs) {
    const fullDir = join(claudeProjectsDir, dir);
    if (results.includes(fullDir)) continue;

    const indexPath = join(fullDir, 'sessions-index.json');
    if (!existsSync(indexPath)) continue;
    try {
      const idx = JSON.parse(await readFile(indexPath, 'utf-8'));
      const origPath = (idx.originalPath || '').replace(/\//g, '\\').toLowerCase();

      // Exact match
      if (origPath === normalizedProject) {
        results.push(fullDir);
        continue;
      }

      // Parent directory match (project was opened from parent dir)
      if (normalizedProject.startsWith(origPath + '\\')) {
        results.push(fullDir);
        continue;
      }

      // Check if any session's projectPath matches
      const entries = Array.isArray(idx.entries) ? idx.entries : Object.values(idx.entries || {});
      const hasMatchingSession = entries.some(s => {
        const sp = (s.projectPath || '').replace(/\//g, '\\').toLowerCase();
        return sp === normalizedProject || normalizedProject.startsWith(sp + '\\');
      });
      if (hasMatchingSession) results.push(fullDir);
    } catch { /* skip corrupt files */ }
  }

  return results;
}

// ── Session filtering ──

async function getSessionsInRange(convDir, startDate, endDate) {
  const indexPath = join(convDir, 'sessions-index.json');
  if (!existsSync(indexPath)) return [];

  const idx = JSON.parse(await readFile(indexPath, 'utf-8'));
  const entries = Array.isArray(idx.entries) ? idx.entries : Object.values(idx.entries || {});

  return entries
    .filter(s => {
      if (s.isSidechain) return false;
      if (!s.created || !s.modified) return false;
      const created = new Date(s.created);
      const modified = new Date(s.modified);
      return created <= endDate && modified >= startDate;
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified))
    .map(s => ({
      sessionId: s.sessionId,
      fullPath: s.fullPath,
      summary: s.summary || s.firstPrompt?.substring(0, 80) || 'Untitled session',
      created: s.created,
      modified: s.modified,
      messageCount: s.messageCount || 0
    }));
}

// ── Context extraction from single JSONL ──

function buildMatchers(filePaths, keywords) {
  const basenames = filePaths.map(fp => basename(fp).toLowerCase());
  const normalizedPaths = filePaths.map(fp =>
    fp.replace(/\\/g, '/').toLowerCase()
  );
  const lowerKeywords = keywords.map(k => k.toLowerCase());

  return { basenames, normalizedPaths, lowerKeywords };
}

function scoreText(text, matchers) {
  if (!text) return 0;
  const lower = text.toLowerCase().replace(/\\/g, '/');
  let score = 0;

  for (const fp of matchers.normalizedPaths) {
    if (lower.includes(fp)) score += 5;
  }
  for (const bn of matchers.basenames) {
    if (lower.includes(bn)) score += 3;
  }
  for (const kw of matchers.lowerKeywords) {
    if (lower.includes(kw)) score += 2;
  }

  return score;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

function extractToolFiles(content) {
  if (!Array.isArray(content)) return [];
  const files = [];
  for (const block of content) {
    if (block.type === 'tool_use' && block.input) {
      if (block.name === 'Edit' || block.name === 'Write' || block.name === 'Read') {
        if (block.input.file_path) files.push(block.input.file_path);
      }
    }
  }
  return files;
}

async function extractContextFromSession(jsonlPath, filePaths, keywords, maxMessages = 10) {
  if (!existsSync(jsonlPath)) return null;

  const matchers = buildMatchers(filePaths, keywords);
  const scored = [];
  const touchedFiles = new Set();
  let firstTimestamp = null;
  let lastTimestamp = null;

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    // Track timestamps
    if (entry.timestamp) {
      if (!firstTimestamp) firstTimestamp = entry.timestamp;
      lastTimestamp = entry.timestamp;
    }

    // User text messages
    if (entry.type === 'user' && entry.message?.content) {
      const text = extractTextFromContent(entry.message.content);
      const score = scoreText(text, matchers);
      if (score > 0) {
        scored.push({
          role: 'user',
          text: text.substring(0, 500),
          timestamp: entry.timestamp,
          score
        });
      }
    }

    // Assistant text messages
    if (entry.type === 'assistant' && entry.message?.content) {
      const content = entry.message.content;
      const text = extractTextFromContent(content);
      const score = scoreText(text, matchers);

      // Also check tool_use blocks for file operations
      const toolFiles = extractToolFiles(content);
      for (const tf of toolFiles) {
        const tfNorm = tf.replace(/\\/g, '/').toLowerCase();
        for (const fp of matchers.normalizedPaths) {
          if (tfNorm.includes(fp) || fp.includes(tfNorm)) {
            touchedFiles.add(tf);
          }
        }
        for (const bn of matchers.basenames) {
          if (basename(tf).toLowerCase() === bn) {
            touchedFiles.add(tf);
          }
        }
      }

      if (score > 0 && text.length > 10) {
        scored.push({
          role: 'assistant',
          text: text.substring(0, 500),
          timestamp: entry.timestamp,
          score
        });
      }
    }

    // File history snapshots — check if our files were tracked
    if (entry.type === 'file-history-snapshot' && entry.snapshot?.trackedFileBackups) {
      for (const [filePath] of Object.entries(entry.snapshot.trackedFileBackups)) {
        const fpNorm = filePath.replace(/\\/g, '/').toLowerCase();
        for (const target of matchers.normalizedPaths) {
          if (fpNorm.includes(target) || target.includes(fpNorm)) {
            touchedFiles.add(filePath);
          }
        }
        for (const bn of matchers.basenames) {
          if (basename(filePath).toLowerCase() === bn) {
            touchedFiles.add(filePath);
          }
        }
      }
    }
  }

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  const relevantMessages = scored.slice(0, maxMessages);

  // Add context window: for each high-scoring message, grab neighbors
  // (Already handled by relevance scoring — adjacent messages score via keywords)

  return {
    sessionId: basename(jsonlPath, '.jsonl'),
    summary: '', // filled by caller from session index
    period: {
      start: firstTimestamp,
      end: lastTimestamp
    },
    relevantMessages,
    touchedFiles: [...touchedFiles]
  };
}

// ── Main API ──

export async function mineProjectContext(projectPath, filePaths, options = {}) {
  const {
    daysBack = 30,
    keywords = [],
    maxSessions = 5,
    maxMessagesPerSession = 10
  } = options;

  const convDirs = await resolveConversationDirs(projectPath);
  if (convDirs.length === 0) {
    return { found: false, reason: 'No conversation directory found for this project' };
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 86400000);

  // Collect sessions from all matching conversation directories
  let allSessions = [];
  for (const convDir of convDirs) {
    const sessions = await getSessionsInRange(convDir, startDate, endDate);
    allSessions.push(...sessions);
  }

  // Deduplicate by sessionId and sort by modified desc
  const seen = new Set();
  allSessions = allSessions.filter(s => {
    if (seen.has(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  }).sort((a, b) => new Date(b.modified) - new Date(a.modified));

  if (allSessions.length === 0) {
    return { found: true, sessions: [], searchedDirs: convDirs };
  }

  const results = [];
  for (const session of allSessions.slice(0, maxSessions * 2)) {
    const context = await extractContextFromSession(
      session.fullPath,
      filePaths,
      keywords,
      maxMessagesPerSession
    );

    if (context && context.relevantMessages.length > 0) {
      context.summary = session.summary;
      results.push(context);
    }

    if (results.length >= maxSessions) break;
  }

  return { found: true, sessions: results, searchedDirs: convDirs };
}
