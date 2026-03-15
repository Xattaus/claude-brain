import MiniSearch from 'minisearch';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * TextIndex — MiniSearch BM25 + fuzzy wrapper for Brain entries.
 * Provides O(1) search with BM25 scoring, fuzzy matching, and prefix search.
 * Persists to .brain/text-index.json for fast startup.
 */
export class TextIndex {
  constructor(brainPath) {
    this.brainPath = brainPath;
    this.indexPath = join(brainPath, 'text-index.json');
    this.mainIndexPath = join(brainPath, 'index.json');
    this.miniSearch = null;
    this._initialized = false;
  }

  /**
   * Create a fresh MiniSearch instance with our config
   */
  _createMiniSearch() {
    return new MiniSearch({
      fields: ['title', 'tags_text', 'content'],
      storeFields: ['title', 'tags_text'],
      searchOptions: {
        boost: { title: 3, tags_text: 2, content: 1 },
        fuzzy: 0.2,
        prefix: true
      }
    });
  }

  /**
   * Initialize: load from persisted index or rebuild from entries
   */
  async initialize(entries, getContent) {
    if (this._initialized) return;

    // Try loading persisted index
    const loaded = await this._loadPersistedIndex();
    if (loaded) {
      this._initialized = true;
      return;
    }

    // Build from scratch
    await this.rebuild(entries, getContent);
    this._initialized = true;
  }

  /**
   * Load persisted text-index.json if it's newer than index.json
   */
  async _loadPersistedIndex() {
    try {
      const [indexStat, textStat] = await Promise.all([
        stat(this.mainIndexPath).catch(() => null),
        stat(this.indexPath).catch(() => null)
      ]);

      if (!textStat || !indexStat) return false;

      // Rebuild if text-index is older than main index
      if (textStat.mtimeMs < indexStat.mtimeMs) return false;

      const data = await readFile(this.indexPath, 'utf-8');
      const json = JSON.parse(data);
      this.miniSearch = MiniSearch.loadJSON(JSON.stringify(json), {
        fields: ['title', 'tags_text', 'content'],
        storeFields: ['title', 'tags_text'],
        searchOptions: {
          boost: { title: 3, tags_text: 2, content: 1 },
          fuzzy: 0.2,
          prefix: true
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rebuild the entire index from entries
   * @param {Array} entries - index.json entries array
   * @param {Function} getContent - async (entry) => string, returns body content
   */
  async rebuild(entries, getContent) {
    this.miniSearch = this._createMiniSearch();

    const docs = [];
    for (const entry of entries) {
      const content = getContent ? await getContent(entry) : '';
      docs.push({
        id: entry.id,
        title: entry.title || '',
        tags_text: (Array.isArray(entry.tags) ? entry.tags : []).join(' '),
        content: content || ''
      });
    }

    if (docs.length > 0) {
      this.miniSearch.addAll(docs);
    }

    await this._persist();
  }

  /**
   * Add a single entry to the index
   */
  addEntry(entry, content = '') {
    if (!this.miniSearch) return;
    try {
      this.miniSearch.add({
        id: entry.id,
        title: entry.title || '',
        tags_text: (Array.isArray(entry.tags) ? entry.tags : []).join(' '),
        content: content || ''
      });
      this._persistAsync();
    } catch {
      // Duplicate ID — remove and re-add
      try {
        this.miniSearch.discard(entry.id);
        this.miniSearch.add({
          id: entry.id,
          title: entry.title || '',
          tags_text: (Array.isArray(entry.tags) ? entry.tags : []).join(' '),
          content: content || ''
        });
        this._persistAsync();
      } catch { /* ignore */ }
    }
  }

  /**
   * Remove an entry from the index
   */
  removeEntry(id) {
    if (!this.miniSearch) return;
    try {
      this.miniSearch.discard(id);
      this._persistAsync();
    } catch { /* ignore if not found */ }
  }

  /**
   * Update an entry in the index (remove + re-add)
   */
  updateEntry(entry, content = '') {
    this.removeEntry(entry.id);
    this.addEntry(entry, content);
  }

  /**
   * Search using MiniSearch BM25 + fuzzy + prefix
   * @param {string} query
   * @param {Object} [options]
   * @returns {Array<{id, score, match}>}
   */
  search(query, options = {}) {
    if (!this.miniSearch || !query || query.trim() === '') return [];

    const searchOpts = {
      boost: { title: 3, tags_text: 2, content: 1 },
      fuzzy: 0.2,
      prefix: true,
      ...options
    };

    return this.miniSearch.search(query, searchOpts);
  }

  /**
   * Persist index to disk
   */
  async _persist() {
    if (!this.miniSearch) return;
    try {
      const json = this.miniSearch.toJSON();
      await writeFile(this.indexPath, JSON.stringify(json), 'utf-8');
    } catch (err) {
      process.stderr.write(`[brain] Warning: Could not persist text-index: ${err.message}\n`);
    }
  }

  /**
   * Async persist (fire-and-forget, non-blocking)
   */
  _persistAsync() {
    this._persist().catch(() => {});
  }
}
