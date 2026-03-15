import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TextIndex } from './text-index.js';

/**
 * Search module for .brain/ entries
 * Uses MiniSearch for BM25 + fuzzy + prefix search with boost phase.
 * Falls back to linear scan if text index is not available.
 */
export class BrainSearch {
  constructor(brainManager) {
    this.manager = brainManager;
    this.textIndex = new TextIndex(brainManager.brainPath);
    this._textIndexReady = false;
  }

  /**
   * Ensure text index is initialized
   */
  async _ensureTextIndex() {
    if (this._textIndexReady) return;

    try {
      const index = await this.manager.loadIndex();
      await this.textIndex.initialize(index.entries, async (entry) => {
        try {
          const fullPath = join(this.manager.brainPath, entry.path);
          return await readFile(fullPath, 'utf-8');
        } catch {
          return '';
        }
      });
      this._textIndexReady = true;
    } catch (err) {
      process.stderr.write(`[brain] Warning: Text index init failed, using fallback: ${err.message}\n`);
    }
  }

  /**
   * Invalidate text index (call after external changes to entries)
   */
  invalidateIndex() {
    this._textIndexReady = false;
  }

  /**
   * Full-text search across all entries.
   * Fast path: MiniSearch results → boost phase (freshness, status, connections)
   * Fallback: linear scan if text index unavailable
   */
  async search(query, { type, tags } = {}) {
    const index = await this.manager.loadIndex();
    let entries = index.entries;

    // Filter by type
    if (type) {
      entries = entries.filter(e => e.type === type);
    }

    // Filter by tags
    if (tags && (Array.isArray(tags) ? tags : [tags]).length > 0) {
      const tagsArr = Array.isArray(tags) ? tags : [tags];
      const tagSet = new Set(tagsArr.map(t => t.toLowerCase()));
      entries = entries.filter(e =>
        Array.isArray(e.tags) && e.tags.some(t => tagSet.has(t.toLowerCase()))
      );
    }

    if (!query || query.trim() === '') {
      return entries.map(e => ({
        id: e.id,
        title: e.title,
        type: e.type,
        status: e.status,
        tags: e.tags,
        snippet: ''
      }));
    }

    // Try MiniSearch fast path
    await this._ensureTextIndex();
    const entryIds = new Set(entries.map(e => e.id));

    if (this._textIndexReady) {
      return this._searchWithMiniSearch(query, entries, entryIds, index);
    }

    // Fallback: linear scan
    return this._searchFallback(query, entries);
  }

  /**
   * Fast path: MiniSearch BM25 + fuzzy search with boost phase
   */
  async _searchWithMiniSearch(query, filteredEntries, entryIds, index) {
    const miniResults = this.textIndex.search(query);

    // Build entry lookup for filtered set
    const entryMap = new Map(filteredEntries.map(e => [e.id, e]));

    // Map MiniSearch results to our format, filtering by type/tag constraints
    const scoreMap = new Map();
    const results = [];
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    for (const mr of miniResults) {
      if (!entryIds.has(mr.id)) continue;
      const entry = entryMap.get(mr.id);
      if (!entry) continue;

      scoreMap.set(entry.id, mr.score);
      const snippet = await this.getSnippet(entry, queryWords);
      results.push({
        id: entry.id,
        title: entry.title,
        type: entry.type,
        status: entry.status,
        date: entry.date,
        tags: entry.tags,
        related: entry.related || [],
        score: mr.score,
        snippet
      });
    }

    // Apply boosts
    this.applyBoosts(results, scoreMap);

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Fallback: original linear scan search
   */
  async _searchFallback(query, entries) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const scoreMap = new Map();
    const results = [];

    for (const entry of entries) {
      const score = await this._scoreEntryFallback(entry, queryWords);
      if (score > 0) {
        scoreMap.set(entry.id, score);
        const snippet = await this.getSnippet(entry, queryWords);
        results.push({
          id: entry.id,
          title: entry.title,
          type: entry.type,
          status: entry.status,
          date: entry.date,
          tags: entry.tags,
          related: entry.related || [],
          score,
          snippet
        });
      }
    }

    this.applyBoosts(results, scoreMap);
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Fallback scoring: title 3pt, tag 2pt, content 1pt per word
   */
  async _scoreEntryFallback(entry, queryWords) {
    let score = 0;
    const titleLower = entry.title.toLowerCase();
    const tagsLower = (Array.isArray(entry.tags) ? entry.tags : []).map(t => t.toLowerCase());

    for (const word of queryWords) {
      if (titleLower.includes(word)) score += 3;
      if (tagsLower.some(t => t.includes(word))) score += 2;
    }

    try {
      const fullPath = join(this.manager.brainPath, entry.path);
      const content = (await readFile(fullPath, 'utf-8')).toLowerCase();
      for (const word of queryWords) {
        if (content.includes(word)) score += 1;
      }
    } catch { /* ignore */ }

    return score;
  }

  /**
   * Apply boosts to search results:
   * - Freshness: <=7d ×1.5, <=30d ×1.2, <=90d ×1.0, older ×0.8
   * - Status: active/current/open ×1.1, superseded ×0.7
   * - Connections: +1pt per linked entry that also matched the search
   */
  applyBoosts(results, scoreMap) {
    const now = Date.now();

    for (const result of results) {
      let boostedScore = result.score;

      // Freshness boost
      if (result.date) {
        const entryDate = new Date(result.date).getTime();
        const daysSince = (now - entryDate) / (1000 * 60 * 60 * 24);
        if (daysSince <= 7) {
          boostedScore *= 1.5;
        } else if (daysSince <= 30) {
          boostedScore *= 1.2;
        } else if (daysSince <= 90) {
          // no change (×1.0)
        } else {
          boostedScore *= 0.8;
        }
      }

      // Status boost
      const status = (result.status || '').toLowerCase();
      if (['active', 'current', 'open'].includes(status)) {
        boostedScore *= 1.1;
      } else if (status === 'superseded') {
        boostedScore *= 0.7;
      }

      // Connection boost: +1pt per linked entry that also matched
      if (result.related && result.related.length > 0) {
        for (const rel of result.related) {
          if (scoreMap.has(rel.id)) {
            boostedScore += 1;
          }
        }
      }

      result.score = boostedScore;
    }
  }

  /**
   * Extract a relevant snippet from entry content
   */
  async getSnippet(entry, queryWords) {
    try {
      const fullPath = join(this.manager.brainPath, entry.path);
      const content = await readFile(fullPath, 'utf-8');

      // Skip frontmatter
      const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
      const body = fmEnd !== -1 ? content.substring(fmEnd + 3).trim() : content;

      // Find first line containing a query word
      const lines = body.split('\n');
      for (const line of lines) {
        const lineLower = line.toLowerCase();
        if (queryWords.some(w => lineLower.includes(w)) && line.trim().length > 0) {
          const trimmed = line.trim();
          return trimmed.length > 150 ? trimmed.substring(0, 150) + '...' : trimmed;
        }
      }

      // Fallback: first non-empty, non-heading line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 10 && !trimmed.startsWith('#')) {
          return trimmed.length > 150 ? trimmed.substring(0, 150) + '...' : trimmed;
        }
      }
    } catch {
      // ignore
    }

    return '';
  }

  /**
   * Extract tags from a natural language description (for conflict checking)
   */
  extractKeywords(text) {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor',
      'not', 'so', 'if', 'that', 'this', 'it', 'its', 'my', 'your',
      // Finnish stop words
      'ja', 'tai', 'on', 'ei', 'se', 'kun', 'jos', 'niin', 'joka', 'tämä',
      'ole', 'olla', 'oli', 'sen', 'voi', 'myös', 'kuin', 'nyt', 'sitten',
      'joten', 'koska', 'mutta', 'sekä', 'eli', 'vai', 'ettei', 'mikä',
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-zäöå0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }
}
