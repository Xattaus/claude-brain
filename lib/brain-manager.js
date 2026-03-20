import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import lockfile from 'proper-lockfile';
import { TextIndex } from './text-index.js';
import { RuleIndex } from './rule-index.js';

/**
 * BrainManager — CRUD for .brain/ folder
 * Handles reading/writing entries, managing index.json, creating files with YAML frontmatter
 */
export class BrainManager {
  static INVERSE_RELATIONS = {
    supersedes: 'superseded_by',
    superseded_by: 'supersedes',
    caused_by: 'relates_to',
    implements: 'relates_to',
    fixes: 'relates_to',
    used_in: 'relates_to',
    relates_to: 'relates_to'
  };

  constructor(projectPath) {
    this.projectPath = projectPath;
    this.brainPath = join(projectPath, '.brain');
    this.indexPath = join(this.brainPath, 'index.json');
    this.changelogPath = join(this.brainPath, 'history', 'changelog.md');
    this.textIndex = new TextIndex(this.brainPath);
    this.ruleIndex = new RuleIndex();
    this._indexVersion = 0;
  }

  // ── Index management ──

  async loadIndex() {
    try {
      const data = await readFile(this.indexPath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      process.stderr.write(`[brain] Warning: Could not load index.json: ${err.message}\n`);
      return { version: 1, project: '', entries: [], counters: { DEC: 0, BUG: 0, IMPL: 0, PAT: 0, PLAN: 0, LES: 0 } };
    }
  }

  async saveIndex(index) {
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * Execute an operation with a lock on index.json
   */
  async withLock(operation) {
    // If index.json doesn't exist yet, we can't lock it properly with proper-lockfile 
    // (it needs a real file). In that case, we just run the op, assuming initBrain 
    // is run sequentially or index exists.
    if (!existsSync(this.indexPath)) {
      return await operation();
    }

    let release;
    try {
      // Retries: wait up to 2 seconds total (approx) to acquire lock
      release = await lockfile.lock(this.indexPath, {
        retries: {
          retries: 10,
          factor: 2,
          minTimeout: 100,
          maxTimeout: 1000,
          randomize: true
        }
      });
      return await operation();
    } finally {
      if (release) await release();
    }
  }

  /**
   * Get next ID for a given type prefix (DEC, BUG, IMPL, PAT)
   */
  nextId(index, prefix) {
    const current = index.counters[prefix] || 0;
    const next = current + 1;
    index.counters[prefix] = next;
    return `${prefix}-${String(next).padStart(3, '0')}`;
  }

  // ── Path normalization ──

  /**
   * Normalize a file path for comparison: backslash → forward slash, strip ./, lowercase
   */
  normalizePath(p) {
    return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  // ── Entry CRUD ──

  /**
   * Create a new entry file with YAML frontmatter and body
   */
  async createEntry({ type, prefix, dirName, title, frontmatter, body }) {
    let result;

    // We lock the WHOLE process of reading index -> calculating ID -> updating index
    // to ensure no ID collisions or lost updates.
    await this.withLock(async () => {
      const index = await this.loadIndex();
      const id = this.nextId(index, prefix);

      const slug = this.slugify(title);
      const fileName = `${id}-${slug}.md`;
      const relPath = `${dirName}/${fileName}`;
      const fullPath = join(this.brainPath, dirName, fileName);

      // Build YAML frontmatter
      const yamlLines = ['---'];
      yamlLines.push(`id: ${id}`);
      yamlLines.push(`type: ${type}`);
      yamlLines.push(`title: "${this.escapeYaml(title)}"`);
      yamlLines.push(`date: ${this.today()}`);
      yamlLines.push(`last_reviewed: ${this.today()}`);
      for (const [key, value] of Object.entries(frontmatter)) {
        yamlLines.push(`${key}: ${this.formatYamlValue(value)}`);
      }
      yamlLines.push('---');
      yamlLines.push('');

      const content = yamlLines.join('\n') + body;

      // Ensure directory exists
      const dirPath = join(this.brainPath, dirName);
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      await writeFile(fullPath, content, 'utf-8');

      // Update index
      const indexEntry = {
        id,
        type,
        title,
        status: frontmatter.status || 'active',
        date: this.today(),
        last_reviewed: this.today(),
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : (frontmatter.tags ? [String(frontmatter.tags)] : []),
        files: frontmatter.files || [],
        related: (frontmatter.related || []).map(r =>
          typeof r === 'object' && r !== null && r.id && r.rel
            ? { id: r.id, rel: r.rel }
            : r
        ),
        path: relPath
      };
      // Store severity in index for conflict checking (bugs and lessons)
      if (frontmatter.severity) {
        indexEntry.severity = typeof frontmatter.severity === 'string'
          ? frontmatter.severity.replace(/^"|"$/g, '')
          : frontmatter.severity;
      }
      // Store trigger for lessons
      if (frontmatter.trigger) {
        indexEntry.trigger = typeof frontmatter.trigger === 'string'
          ? frontmatter.trigger.replace(/^"|"$/g, '')
          : frontmatter.trigger;
      }
      index.entries.push(indexEntry);

      await this.saveIndex(index);

      // Return result to outer scope
      result = { id, path: relPath, fullPath, _indexEntry: indexEntry, _body: body };
    });

    // Incremental text index update (outside lock, non-critical)
    try {
      if (result._indexEntry) {
        this.textIndex.addEntry(result._indexEntry, result._body || '');
        this._indexVersion++;
      }
    } catch { /* non-critical */ }

    // Append to changelog (can be outside lock, less critical)
    await this.appendChangelog(`Created ${result.id}: ${title}`);

    // Sync recent entries to CLAUDE.md / GEMINI.md
    await this.syncRecentToClaudeMd();

    return result;
  }

  /**
   * Sync the 5 most recent brain entries to CLAUDE.md (or GEMINI.md).
   * Updates the section between <!-- BRAIN_RECENT_START --> and <!-- BRAIN_RECENT_END -->.
   * If markers don't exist, the sync is skipped.
   */
  async syncRecentToClaudeMd() {
    // Try CLAUDE.md first, then GEMINI.md
    const candidates = ['CLAUDE.md', 'GEMINI.md'];
    let targetPath = null;
    let content = null;

    for (const name of candidates) {
      const p = join(this.projectPath, name);
      try {
        content = await readFile(p, 'utf-8');
        targetPath = p;
        break;
      } catch { /* try next */ }
    }

    if (!targetPath || !content) return;
    if (!content.includes('<!-- BRAIN_RECENT_START -->')) return;

    try {
      const index = await this.loadIndex();
      const recent = [...index.entries]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 5);

      let recentSection = '';
      if (recent.length > 0) {
        recentSection = recent.map(e =>
          `- **${e.id}** (${e.type}) ${e.title} — _${e.status}_ [${e.date}]`
        ).join('\n');
      } else {
        recentSection = '_Ei merkintöjä vielä._';
      }

      const updated = content.replace(
        /<!-- BRAIN_RECENT_START -->[\s\S]*?<!-- BRAIN_RECENT_END -->/,
        `<!-- BRAIN_RECENT_START -->\n${recentSection}\n<!-- BRAIN_RECENT_END -->`
      );

      await writeFile(targetPath, updated, 'utf-8');
    } catch (err) {
      process.stderr.write(`[brain] Warning: Could not sync to ${targetPath}: ${err.message}\n`);
    }
  }

  /**
   * Read an entry by its ID (e.g. "DEC-001")
   */
  async getEntry(id) {
    const index = await this.loadIndex();
    const entry = index.entries.find(e => e.id === id);
    if (!entry) return null;

    const fullPath = join(this.brainPath, entry.path);
    try {
      const content = await readFile(fullPath, 'utf-8');
      return { ...entry, content };
    } catch {
      return null;
    }
  }

  /**
   * Read the overview.md file
   */
  async getOverview() {
    const overviewPath = join(this.brainPath, 'overview.md');
    try {
      return await readFile(overviewPath, 'utf-8');
    } catch {
      return 'No overview found. Run install.js to initialize.';
    }
  }

  /**
   * List entries filtered by type, status, and/or tags
   */
  async listEntries({ type, status, tags } = {}) {
    const index = await this.loadIndex();
    let results = index.entries;

    if (type) {
      results = results.filter(e => e.type === type);
    }
    if (status) {
      results = results.filter(e => e.status === status);
    }
    if (tags && (Array.isArray(tags) ? tags : [tags]).length > 0) {
      const tagsArr = Array.isArray(tags) ? tags : [tags];
      const tagSet = new Set(tagsArr.map(t => t.toLowerCase()));
      results = results.filter(e =>
        Array.isArray(e.tags) && e.tags.some(t => tagSet.has(t.toLowerCase()))
      );
    }

    return results.map(e => ({
      id: e.id,
      title: e.title,
      type: e.type,
      status: e.status,
      date: e.date,
      tags: e.tags
    }));
  }

  /**
   * Update an existing entry's metadata and/or content
   */
  async updateEntry(id, updates) {
    let result = null;

    await this.withLock(async () => {
      const index = await this.loadIndex();
      const entryIdx = index.entries.findIndex(e => e.id === id);
      if (entryIdx === -1) return;

      const entry = index.entries[entryIdx];
      const fullPath = join(this.brainPath, entry.path);

      let content;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        return;
      }

      // Update frontmatter fields
      if (updates.status) {
        content = this.updateFrontmatterField(content, 'status', updates.status);
        entry.status = updates.status;
      }
      if (updates.title) {
        content = this.updateFrontmatterField(content, 'title', `"${this.escapeYaml(updates.title)}"`);
        entry.title = updates.title;
      }

      // Append new relations
      if (updates.add_related && updates.add_related.length > 0) {
        if (!entry.related) entry.related = [];
        for (const rel of updates.add_related) {
          if (!entry.related.some(r => r.id === rel.id && r.rel === rel.rel)) {
            entry.related.push({ id: rel.id, rel: rel.rel });
          }
        }
        // Update frontmatter in file
        const relatedYaml = entry.related.map(r => `"${r.id}:${r.rel}"`);
        content = this.updateFrontmatterField(content, 'related', `[${relatedYaml.join(', ')}]`);
      }

      // Replace body content if provided
      if (updates.content) {
        const bodyStart = content.indexOf('---', content.indexOf('---') + 3);
        if (bodyStart !== -1) {
          const afterFrontmatter = content.substring(0, bodyStart + 3);
          content = afterFrontmatter + '\n\n' + updates.content;
        }
      }

      // Always refresh last_reviewed on any update
      entry.last_reviewed = this.today();
      if (content.includes('last_reviewed:')) {
        content = this.updateFrontmatterField(content, 'last_reviewed', this.today());
      } else {
        content = content.replace(/^(date: .+)$/m, `$1\nlast_reviewed: ${this.today()}`);
      }

      await writeFile(fullPath, content, 'utf-8');

      // Update index
      index.entries[entryIdx] = entry;
      await this.saveIndex(index);

      result = entry;
    });

    if (result) {
      // Incremental text index update
      try {
        const fullPath = join(this.brainPath, result.path);
        const content = await readFile(fullPath, 'utf-8').catch(() => '');
        this.textIndex.updateEntry(result, content);
        this._indexVersion++;
      } catch { /* non-critical */ }

      // Log change
      const changedFields = Object.keys(updates).join(', ');
      await this.appendChangelog(`Updated ${id}: ${changedFields}`);
    }

    return result;
  }

  /**
   * Get entries whose files[] match any of the given file paths.
   * Uses segment-boundary matching: 'utils.js' does NOT match 'test-utils.js',
   * but 'src/utils.js' DOES match 'utils.js' (at path separator boundary).
   */
  async getEntriesByFiles(filePaths) {
    const index = await this.loadIndex();
    const normalizedPaths = filePaths.map(f => this.normalizePath(f));

    return index.entries.filter(e =>
      Array.isArray(e.files) && e.files.some(ef => {
        const normEf = this.normalizePath(ef);
        return normalizedPaths.some(np => {
          // Exact match
          if (np === normEf) return true;
          // Suffix match: ensure match starts at a path separator boundary
          if (np.endsWith(normEf)) {
            const charBefore = np[np.length - normEf.length - 1];
            return charBefore === '/' || charBefore === undefined;
          }
          if (normEf.endsWith(np)) {
            const charBefore = normEf[normEf.length - np.length - 1];
            return charBefore === '/' || charBefore === undefined;
          }
          return false;
        });
      })
    );
  }

  /**
   * Get entries matching any of the given tags
   */
  async getEntriesByTags(tags) {
    const index = await this.loadIndex();
    const tagsArr = Array.isArray(tags) ? tags : [tags];
    const tagSet = new Set(tagsArr.map(t => t.toLowerCase()));

    return index.entries.filter(e =>
      Array.isArray(e.tags) && e.tags.some(t => tagSet.has(t.toLowerCase()))
    );
  }

  /**
   * Check for duplicate entries using Jaccard similarity on title words.
   * Returns matching entries with similarity score if above threshold.
   * @param {string} title - New entry title
   * @param {string} type - Entry type (decision, bug, etc.)
   * @param {number} [threshold=0.7] - Similarity threshold (0-1)
   * @returns {Array<{id, title, similarity}>}
   */
  async checkDuplicate(title, type, threshold = 0.7) {
    const index = await this.loadIndex();
    const titleWords = new Set(title.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (titleWords.size === 0) return [];

    const duplicates = [];
    for (const entry of index.entries) {
      if (type && entry.type !== type) continue;
      if (entry.status === 'superseded' || entry.status === 'abandoned') continue;

      const entryWords = new Set(entry.title.toLowerCase().split(/\s+/).filter(w => w.length > 2));
      if (entryWords.size === 0) continue;

      // Jaccard similarity: |intersection| / |union|
      const intersection = new Set([...titleWords].filter(w => entryWords.has(w)));
      const union = new Set([...titleWords, ...entryWords]);
      const similarity = intersection.size / union.size;

      if (similarity >= threshold) {
        duplicates.push({ id: entry.id, title: entry.title, similarity: Math.round(similarity * 100) / 100 });
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  // ── Relation graph ──

  /**
   * Link two entries with a typed relation (bidirectional)
   */
  async linkEntries(fromId, toId, rel) {
    const inverseRel = BrainManager.INVERSE_RELATIONS[rel];
    if (!inverseRel) {
      throw new Error(`Unknown relation type: ${rel}. Valid: ${Object.keys(BrainManager.INVERSE_RELATIONS).join(', ')}`);
    }

    let result = null;

    await this.withLock(async () => {
      const index = await this.loadIndex();
      const fromEntry = index.entries.find(e => e.id === fromId);
      const toEntry = index.entries.find(e => e.id === toId);
      if (!fromEntry) throw new Error(`Entry not found: ${fromId}`);
      if (!toEntry) throw new Error(`Entry not found: ${toId}`);

      // Add forward relation
      if (!fromEntry.related) fromEntry.related = [];
      if (!fromEntry.related.some(r => r.id === toId && r.rel === rel)) {
        fromEntry.related.push({ id: toId, rel });
      }

      // Add inverse relation
      if (!toEntry.related) toEntry.related = [];
      if (!toEntry.related.some(r => r.id === fromId && r.rel === inverseRel)) {
        toEntry.related.push({ id: fromId, rel: inverseRel });
      }

      await this.saveIndex(index);

      // Update frontmatter in both files
      await this.updateFileFrontmatterRelated(fromEntry);
      await this.updateFileFrontmatterRelated(toEntry);

      result = { from: fromId, to: toId, rel, inverseRel };
    });

    if (result) {
      await this.appendChangelog(`Linked ${fromId} —[${rel}]→ ${toId}`);
    }

    return result;
  }

  /**
   * Follow supersedes chain from an entry to the end
   * Returns array of {id, title, status} from newest to oldest
   */
  async getSupersededChain(entryId) {
    const index = await this.loadIndex();
    const chain = [];
    const visited = new Set();
    let currentId = entryId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const entry = index.entries.find(e => e.id === currentId);
      if (!entry) break;

      chain.push({ id: entry.id, title: entry.title, status: entry.status });

      // Follow the supersedes link
      const supersededRel = (entry.related || []).find(r => r.rel === 'supersedes');
      currentId = supersededRel ? supersededRel.id : null;
    }

    return chain;
  }

  /**
   * Get all brain context for given files — decisions, bugs, implementations, patterns
   * Follows related links (2 levels) and supersedes chains using graph traversal
   */
  async getContextForFiles(filePaths) {
    // 1. Find entries matching files
    const directMatches = await this.getEntriesByFiles(filePaths);
    const index = await this.loadIndex();
    const allIds = new Set(directMatches.map(e => e.id));

    // 2. Graph traversal: follow relations 2 levels deep from each direct match
    for (const entry of directMatches) {
      if (entry.related) {
        for (const rel of entry.related) {
          allIds.add(rel.id);
          // 2nd level: follow relations of related entries
          const relEntry = index.entries.find(e => e.id === rel.id);
          if (relEntry && relEntry.related) {
            for (const rel2 of relEntry.related) {
              allIds.add(rel2.id);
            }
          }
        }
      }
    }

    // 3. Follow supersedes chains for direct matches
    for (const entry of directMatches) {
      const chain = await this.getSupersededChain(entry.id);
      for (const item of chain) {
        allIds.add(item.id);
      }
    }

    // 4. Deduplicate and group by type
    const allEntries = index.entries.filter(e => allIds.has(e.id));

    return {
      decisions: allEntries.filter(e => e.type === 'decision'),
      bugs: allEntries.filter(e => e.type === 'bug'),
      implementations: allEntries.filter(e => e.type === 'implementation'),
      patterns: allEntries.filter(e => e.type === 'pattern'),
      lessons: allEntries.filter(e => e.type === 'lesson')
    };
  }

  // ── Review & Health ──

  /**
   * Mark an entry as reviewed without changing its content
   */
  async reviewEntry(id, notes) {
    let result = null;

    await this.withLock(async () => {
      const index = await this.loadIndex();
      const entryIdx = index.entries.findIndex(e => e.id === id);
      if (entryIdx === -1) return;

      const entry = index.entries[entryIdx];
      const reviewDate = this.today();
      entry.last_reviewed = reviewDate;

      const fullPath = join(this.brainPath, entry.path);
      let content;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        return;
      }

      if (content.includes('last_reviewed:')) {
        content = this.updateFrontmatterField(content, 'last_reviewed', reviewDate);
      } else {
        content = content.replace(/^(date: .+)$/m, `$1\nlast_reviewed: ${reviewDate}`);
      }

      await writeFile(fullPath, content, 'utf-8');
      index.entries[entryIdx] = entry;
      await this.saveIndex(index);

      result = { id, last_reviewed: reviewDate };
    });

    if (result) {
      const noteText = notes ? ` (${notes})` : '';
      await this.appendChangelog(`Reviewed ${id}${noteText}`);
    }

    return result;
  }

  /**
   * Get health statistics for the brain
   */
  async getHealthData(thresholdDays = 30) {
    const index = await this.loadIndex();
    const now = Date.now();
    const msPerDay = 86400000;

    const stats = {
      total: index.entries.length,
      byType: {},
      byStatus: {},
      stale: [],
      orphaned: [],
      brokenLinks: [],
      missingBidirectional: [],
      activeDecisionsWithoutImpl: [],
      oldOpenBugs: [],
      incompletePlans: [],
    };

    const referencedIds = new Set();
    const allIds = new Set(index.entries.map(e => e.id));

    for (const entry of index.entries) {
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
      stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;

      // Staleness
      const reviewDate = entry.last_reviewed || entry.date;
      const daysSince = (now - new Date(reviewDate).getTime()) / msPerDay;
      if (daysSince > thresholdDays) {
        stats.stale.push({ id: entry.id, title: entry.title, daysSince: Math.round(daysSince) });
      }

      // Collect referenced IDs + check broken links
      if (entry.related && entry.related.length > 0) {
        for (const rel of entry.related) {
          referencedIds.add(rel.id);
          if (!allIds.has(rel.id)) {
            stats.brokenLinks.push({ from: entry.id, to: rel.id, rel: rel.rel });
          }
        }
      }

      // Old open bugs
      if (entry.type === 'bug' && entry.status === 'open') {
        const age = (now - new Date(entry.date).getTime()) / msPerDay;
        if (age > 60) {
          stats.oldOpenBugs.push({ id: entry.id, title: entry.title, ageDays: Math.round(age) });
        }
      }

      // Incomplete plans
      if (entry.type === 'plan' && (entry.status === 'partial' || entry.status === 'planned' || entry.status === 'in_progress')) {
        stats.incompletePlans.push({ id: entry.id, title: entry.title, status: entry.status, priority: entry.priority || 'medium' });
      }
    }

    // Orphan detection
    for (const entry of index.entries) {
      const hasOutgoing = entry.related && entry.related.length > 0;
      const hasIncoming = referencedIds.has(entry.id);
      if (!hasOutgoing && !hasIncoming) {
        stats.orphaned.push({ id: entry.id, title: entry.title, type: entry.type });
      }
    }

    // Active decisions without implementations
    const activeDecisions = index.entries.filter(e => e.type === 'decision' && e.status === 'active');
    for (const dec of activeDecisions) {
      const hasImpl = (dec.related || []).some(r => {
        const target = index.entries.find(e => e.id === r.id);
        return target && target.type === 'implementation';
      });
      if (!hasImpl) {
        stats.activeDecisionsWithoutImpl.push({ id: dec.id, title: dec.title });
      }
    }

    // Bidirectional link check
    for (const entry of index.entries) {
      if (!entry.related) continue;
      for (const rel of entry.related) {
        const target = index.entries.find(e => e.id === rel.id);
        if (!target || !target.related) continue;
        const hasInverse = target.related.some(r => r.id === entry.id);
        if (!hasInverse) {
          stats.missingBidirectional.push({ from: entry.id, to: rel.id, rel: rel.rel });
        }
      }
    }

    return stats;
  }

  // ── Changelog ──

  async appendChangelog(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const line = `- **${timestamp}** — ${message}\n`;

    const dir = join(this.brainPath, 'history');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    let existing = '';
    try {
      existing = await readFile(this.changelogPath, 'utf-8');
    } catch {
      existing = '# Muutoshistoria\n\n';
    }

    // Insert new entry after the header
    const headerEnd = existing.indexOf('\n\n');
    if (headerEnd !== -1) {
      existing = existing.substring(0, headerEnd + 2) + line + existing.substring(headerEnd + 2);
    } else {
      existing += '\n' + line;
    }

    await writeFile(this.changelogPath, existing, 'utf-8');
  }

  async getHistory({ since, limit = 20 } = {}) {
    try {
      const content = await readFile(this.changelogPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.startsWith('- **'));

      let filtered = lines;
      if (since) {
        filtered = lines.filter(l => {
          const match = l.match(/\*\*(.+?)\*\*/);
          return match && match[1] >= since;
        });
      }

      return filtered.slice(0, limit).join('\n');
    } catch {
      return 'No history yet.';
    }
  }

  // ── Helpers ──

  slugify(text) {
    return text
      .toLowerCase()
      .replace(/[äå]/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  today() {
    return new Date().toISOString().substring(0, 10);
  }

  escapeYaml(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  formatYamlValue(value) {
    if (Array.isArray(value)) {
      return '[' + value.map(v => {
        if (typeof v === 'object' && v !== null && v.id && v.rel) {
          return `"${v.id}:${v.rel}"`;
        }
        return typeof v === 'string' ? `"${v}"` : v;
      }).join(', ') + ']';
    }
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    return String(value);
  }

  updateFrontmatterField(content, field, newValue) {
    const regex = new RegExp(`^${field}:.*$`, 'm');
    if (regex.test(content)) {
      return content.replace(regex, `${field}: ${newValue}`);
    }
    return content;
  }

  /**
   * Update the related field in an entry's frontmatter file
   */
  async updateFileFrontmatterRelated(entry) {
    const fullPath = join(this.brainPath, entry.path);
    let content;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      return;
    }

    const relatedYaml = (entry.related || []).map(r => `"${r.id}:${r.rel}"`);
    content = this.updateFrontmatterField(content, 'related', `[${relatedYaml.join(', ')}]`);
    await writeFile(fullPath, content, 'utf-8');
  }

  // ── Rule Index ──

  /**
   * Rebuild the rule index from all brain entries.
   * Extracts rules from markdown content and stores them for fast lookup.
   * Also persists rules to index.json.
   * @returns {{ totalRules: number, doCount: number, dontCount: number, guardCount: number, filesCovered: number }}
   */
  async rebuildRuleIndex() {
    const index = await this.loadIndex();
    const self = this;

    const stats = await this.ruleIndex.rebuild(index.entries, async (entry) => {
      const fullPath = join(self.brainPath, entry.path);
      try {
        return await readFile(fullPath, 'utf-8');
      } catch {
        return '';
      }
    });

    // Persist rules to index.json
    await this.withLock(async () => {
      const idx = await this.loadIndex();
      idx.rules = this.ruleIndex.serialize();
      await this.saveIndex(idx);
    });

    return stats;
  }

  /**
   * Load rules from index.json into memory (fast, no file scanning)
   */
  async loadRuleIndex() {
    const index = await this.loadIndex();
    if (index.rules) {
      this.ruleIndex.deserialize(index.rules);
    }
  }

  /**
   * Add rules for a single entry and persist to index.json
   * @param {object} entry - Index entry object
   * @param {string} content - Entry markdown content
   */
  async addRulesForEntry(entry, content) {
    this.ruleIndex.addRulesForEntry(entry, content);

    // Persist updated rules to index.json
    await this.withLock(async () => {
      const idx = await this.loadIndex();
      idx.rules = this.ruleIndex.serialize();
      await this.saveIndex(idx);
    });
  }

  // ── Initialization ──

  /**
   * Load manifest.json
   */
  async loadManifest() {
    try {
      const data = await readFile(join(this.brainPath, 'manifest.json'), 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      process.stderr.write(`[brain] Warning: Could not load manifest.json: ${err.message}\n`);
      return { version: 1, projectName: '', paths: [] };
    }
  }

  /**
   * Rebuild index.json from .brain/ files by scanning YAML frontmatter.
   * Use when index is corrupted, missing entries, or needs recovery.
   * @returns {{ entriesFound: number, counters: object }}
   */
  async rebuildIndex() {
    const dirs = [
      { dir: 'decisions', type: 'decision', prefix: 'DEC' },
      { dir: 'implementations', type: 'implementation', prefix: 'IMPL' },
      { dir: 'bugs', type: 'bug', prefix: 'BUG' },
      { dir: 'patterns', type: 'pattern', prefix: 'PAT' },
      { dir: 'plans', type: 'plan', prefix: 'PLAN' },
      { dir: 'lessons', type: 'lesson', prefix: 'LES' }
    ];
    const entries = [];
    const counters = { DEC: 0, BUG: 0, IMPL: 0, PAT: 0, PLAN: 0, LES: 0 };

    for (const { dir, type, prefix } of dirs) {
      const dirPath = join(this.brainPath, dir);
      if (!existsSync(dirPath)) continue;

      let files;
      try {
        files = await readdir(dirPath);
      } catch (err) {
        process.stderr.write(`[brain] Warning: Could not read ${dir}/: ${err.message}\n`);
        continue;
      }

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = await readFile(join(dirPath, file), 'utf-8');
          const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (!fmMatch) continue;

          const fm = fmMatch[1];
          const getField = (name) => {
            const m = fm.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
            if (!m) return null;
            return m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
          };

          const id = getField('id') || `${prefix}-???`;
          const title = getField('title') || file.replace('.md', '');
          const status = getField('status') || 'active';
          const date = getField('date') || this.today();
          const lastReviewed = getField('last_reviewed') || date;

          // Parse tags: ["tag1", "tag2"]
          const tagsRaw = getField('tags');
          let tags = [];
          if (tagsRaw) {
            try { const parsed = JSON.parse(tagsRaw.replace(/'/g, '"')); tags = Array.isArray(parsed) ? parsed : [parsed]; } catch { tags = []; }
          }

          // Parse files: ["file1", "file2"]
          const filesRaw = getField('files');
          let entryFiles = [];
          if (filesRaw) {
            try { const parsed = JSON.parse(filesRaw.replace(/'/g, '"')); entryFiles = Array.isArray(parsed) ? parsed : [parsed]; } catch { entryFiles = []; }
          }

          // Parse related: ["DEC-001:implements", ...]
          const relatedRaw = getField('related');
          let related = [];
          if (relatedRaw) {
            try {
              const parsed = JSON.parse(relatedRaw.replace(/'/g, '"'));
              const arr = Array.isArray(parsed) ? parsed : [parsed];
              related = arr.map(r => {
                if (typeof r === 'string' && r.includes(':')) {
                  const [rid, rel] = r.split(':');
                  return { id: rid, rel };
                }
                return r;
              }).filter(r => r && r.id && r.rel);
            } catch { related = []; }
          }

          const entry = {
            id, type, title, status, date,
            last_reviewed: lastReviewed,
            tags, files: entryFiles, related,
            path: `${dir}/${file}`
          };

          // Severity for bugs
          const severity = getField('severity');
          if (severity) entry.severity = severity;

          // Priority for plans
          const priority = getField('priority');
          if (priority) entry.priority = priority;

          // Trigger for lessons
          const trigger = getField('trigger');
          if (trigger) entry.trigger = trigger;

          entries.push(entry);

          // Update counter
          const num = parseInt(id.split('-')[1]) || 0;
          if (num > counters[prefix]) counters[prefix] = num;
        } catch (err) {
          process.stderr.write(`[brain] Warning: Could not parse ${dir}/${file}: ${err.message}\n`);
        }
      }
    }

    // Load existing index to preserve project name
    let projectName = '';
    try {
      const existing = await this.loadIndex();
      projectName = existing.project || '';
    } catch { /* ignore */ }

    const index = { version: 1, project: projectName, entries, counters };
    await this.saveIndex(index);
    await this.appendChangelog(`Index rebuilt: ${entries.length} entries recovered`);

    return { entriesFound: entries.length, counters };
  }

  async initBrain({ projectName, overview, paths }) {
    // Create directories
    const dirs = ['decisions', 'implementations', 'bugs', 'patterns', 'plans', 'lessons', 'history'];
    for (const dir of dirs) {
      const dirPath = join(this.brainPath, dir);
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }
    }

    // Create manifest.json with multi-path support
    const manifest = {
      version: 2,
      projectName,
      created: this.today(),
      brainToolVersion: '1.0.0',
      paths: paths || [{ path: this.projectPath, label: 'root' }]
    };
    await writeFile(join(this.brainPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    // Create index.json
    const index = {
      version: 1,
      project: projectName,
      entries: [],
      counters: { DEC: 0, BUG: 0, IMPL: 0, PAT: 0, PLAN: 0, LES: 0 }
    };
    await this.saveIndex(index);

    // Create overview.md
    await writeFile(join(this.brainPath, 'overview.md'), overview, 'utf-8');

    // Create changelog.md
    await writeFile(
      this.changelogPath,
      `# Muutoshistoria\n\n- **${new Date().toISOString().replace('T', ' ').substring(0, 19)}** — Brain initialized for ${projectName}\n`,
      'utf-8'
    );
  }

  // ── Snapshots ──

  /**
   * Create a snapshot of the current .brain/ state.
   * Copies index.json, overview.md, and all entry directories to .brain/snapshots/<timestamp>/
   * @param {string} [label] - Optional label for the snapshot
   * @returns {{ path: string, timestamp: string, entriesCount: number }}
   */
  async createSnapshot(label) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 16);
    const snapshotName = label ? `${timestamp}_${this.slugify(label)}` : timestamp;
    const snapshotDir = join(this.brainPath, 'snapshots', snapshotName);

    await mkdir(snapshotDir, { recursive: true });

    // Copy index.json
    try {
      const indexData = await readFile(this.indexPath, 'utf-8');
      await writeFile(join(snapshotDir, 'index.json'), indexData, 'utf-8');
    } catch (err) {
      process.stderr.write(`[brain] Warning: Could not snapshot index.json: ${err.message}\n`);
    }

    // Copy overview.md
    try {
      const overview = await readFile(join(this.brainPath, 'overview.md'), 'utf-8');
      await writeFile(join(snapshotDir, 'overview.md'), overview, 'utf-8');
    } catch { /* optional */ }

    // Copy entry directories
    const dirs = ['decisions', 'implementations', 'bugs', 'patterns', 'plans', 'lessons'];
    let entriesCount = 0;
    for (const dir of dirs) {
      const srcDir = join(this.brainPath, dir);
      if (!existsSync(srcDir)) continue;

      const destDir = join(snapshotDir, dir);
      await mkdir(destDir, { recursive: true });

      try {
        const files = await readdir(srcDir);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const content = await readFile(join(srcDir, file), 'utf-8');
          await writeFile(join(destDir, file), content, 'utf-8');
          entriesCount++;
        }
      } catch (err) {
        process.stderr.write(`[brain] Warning: Could not snapshot ${dir}/: ${err.message}\n`);
      }
    }

    // Save snapshot metadata
    const meta = {
      timestamp: new Date().toISOString(),
      label: label || null,
      entriesCount,
      name: snapshotName
    };
    await writeFile(join(snapshotDir, 'snapshot.json'), JSON.stringify(meta, null, 2), 'utf-8');

    await this.appendChangelog(`Snapshot created: ${snapshotName} (${entriesCount} entries)`);
    return { path: snapshotDir, timestamp: meta.timestamp, entriesCount };
  }

  /**
   * List available snapshots
   * @returns {Array<{ name: string, timestamp: string, label: string|null, entriesCount: number }>}
   */
  async listSnapshots() {
    const snapshotsDir = join(this.brainPath, 'snapshots');
    if (!existsSync(snapshotsDir)) return [];

    const snapshots = [];
    try {
      const dirs = await readdir(snapshotsDir);
      for (const dir of dirs) {
        try {
          const metaPath = join(snapshotsDir, dir, 'snapshot.json');
          const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
          snapshots.push(meta);
        } catch { /* skip invalid snapshots */ }
      }
    } catch { /* no snapshots dir */ }

    return snapshots.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }

  /**
   * Restore from a snapshot. Creates a backup snapshot first.
   * @param {string} snapshotName - Name of the snapshot directory
   * @returns {{ restored: boolean, entriesCount: number }}
   */
  async restoreSnapshot(snapshotName) {
    const snapshotDir = join(this.brainPath, 'snapshots', snapshotName);
    if (!existsSync(snapshotDir)) {
      throw new Error(`Snapshot not found: ${snapshotName}`);
    }

    // Create a backup of current state first
    await this.createSnapshot('pre-restore-backup');

    // Restore index.json
    try {
      const indexData = await readFile(join(snapshotDir, 'index.json'), 'utf-8');
      await writeFile(this.indexPath, indexData, 'utf-8');
    } catch (err) {
      throw new Error(`Could not restore index.json: ${err.message}`);
    }

    // Restore overview.md
    try {
      const overview = await readFile(join(snapshotDir, 'overview.md'), 'utf-8');
      await writeFile(join(this.brainPath, 'overview.md'), overview, 'utf-8');
    } catch { /* optional */ }

    // Restore entry directories
    const dirs = ['decisions', 'implementations', 'bugs', 'patterns', 'plans', 'lessons'];
    let entriesCount = 0;
    for (const dir of dirs) {
      const srcDir = join(snapshotDir, dir);
      if (!existsSync(srcDir)) continue;

      const destDir = join(this.brainPath, dir);
      await mkdir(destDir, { recursive: true });

      try {
        const files = await readdir(srcDir);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const content = await readFile(join(srcDir, file), 'utf-8');
          await writeFile(join(destDir, file), content, 'utf-8');
          entriesCount++;
        }
      } catch (err) {
        process.stderr.write(`[brain] Warning: Could not restore ${dir}/: ${err.message}\n`);
      }
    }

    await this.appendChangelog(`Restored from snapshot: ${snapshotName} (${entriesCount} entries)`);
    return { restored: true, entriesCount };
  }
}
