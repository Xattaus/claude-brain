import { BrainSearch } from './search.js';

/**
 * ConflictChecker — Detects potential conflicts between proposed changes
 * and existing decisions/bugs/implementations in the brain
 *
 * Three-phase checking:
 * 1. File-based matching (with severity-aware bug handling + supersedes chain context)
 * 2. Tag/keyword matching
 * 3. Relationship traversal (1 level)
 */
export class ConflictChecker {
  constructor(brainManager) {
    this.manager = brainManager;
    this.search = new BrainSearch(brainManager);
  }

  /**
   * Check for conflicts with a proposed change
   * @param {string} proposedChange - Description of the change
   * @param {string[]} affectedFiles - Files that will be modified
   * @returns {{ conflicts: Array, warnings: Array }}
   */
  async check(proposedChange, affectedFiles = []) {
    const conflicts = [];
    const warnings = [];

    // 1. File-based matching: find active decisions affecting same files
    if (affectedFiles.length > 0) {
      const fileMatches = await this.manager.getEntriesByFiles(affectedFiles);

      for (const entry of fileMatches) {
        if (entry.type === 'decision' && entry.status === 'active') {
          // Add supersedes chain context
          let reason = `Active decision affects same files: ${affectedFiles.join(', ')}`;
          const chain = await this.manager.getSupersededChain(entry.id);
          if (chain.length > 1) {
            reason += ` (decision chain: ${chain.map(c => c.id).join(' \u2192 ')})`;
          }
          conflicts.push({
            entry_id: entry.id,
            title: entry.title,
            type: 'decision',
            reason
          });
        } else if (entry.type === 'bug' && entry.status === 'open') {
          // Severity-aware: critical/high → CONFLICT, medium/low → WARNING
          const severity = (entry.severity || 'medium').toLowerCase();
          if (severity === 'critical' || severity === 'high') {
            conflicts.push({
              entry_id: entry.id,
              title: entry.title,
              type: 'bug',
              reason: `Open ${severity} bug exists for: ${entry.files?.join(', ')}`
            });
          } else {
            warnings.push({
              entry_id: entry.id,
              title: entry.title,
              type: 'bug',
              reason: `Open bug exists for: ${entry.files?.join(', ')}`
            });
          }
        } else if (entry.type === 'bug' && entry.status === 'fixed') {
          warnings.push({
            entry_id: entry.id,
            title: entry.title,
            type: 'bug',
            reason: `Previously fixed bug in same files \u2014 review before modifying`
          });
        } else if (entry.type === 'implementation' && entry.status === 'current') {
          warnings.push({
            entry_id: entry.id,
            title: entry.title,
            type: 'implementation',
            reason: `Current implementation documented for these files`
          });
        }
      }
    }

    // 2. Tag/keyword matching from proposed change description
    const keywords = this.search.extractKeywords(proposedChange);
    if (keywords.length > 0) {
      const tagMatches = await this.manager.getEntriesByTags(keywords);

      for (const entry of tagMatches) {
        // Avoid duplicates from file matching
        const isDuplicate = [...conflicts, ...warnings].some(c => c.entry_id === entry.id);
        if (isDuplicate) continue;

        if (entry.type === 'decision' && entry.status === 'active') {
          conflicts.push({
            entry_id: entry.id,
            title: entry.title,
            type: 'decision',
            reason: `Active decision matches keywords: ${keywords.filter(k => entry.tags?.some(t => t.toLowerCase().includes(k))).join(', ')}`
          });
        } else if (entry.type === 'bug' && entry.status === 'open') {
          // Severity-aware for keyword matches too
          const severity = (entry.severity || 'medium').toLowerCase();
          if (severity === 'critical' || severity === 'high') {
            conflicts.push({
              entry_id: entry.id,
              title: entry.title,
              type: 'bug',
              reason: `Open ${severity} bug matches keywords: ${keywords.filter(k => entry.tags?.some(t => t.toLowerCase().includes(k))).join(', ')}`
            });
          } else {
            warnings.push({
              entry_id: entry.id,
              title: entry.title,
              type: 'bug',
              reason: `Open bug matches keywords: ${keywords.filter(k => entry.tags?.some(t => t.toLowerCase().includes(k))).join(', ')}`
            });
          }
        }
      }
    }

    // 3. Relationship traversal (2 levels) — find transitive active decisions / open bugs
    const foundIds = new Set([...conflicts, ...warnings].map(c => c.entry_id));
    const index = await this.manager.loadIndex();
    const entryMap = new Map(index.entries.map(e => [e.id, e]));

    // Traverse 2 levels deep
    const idsToTraverse = [...foundIds];
    for (let depth = 0; depth < 2; depth++) {
      const nextIds = [];
      for (const id of idsToTraverse) {
        const entry = entryMap.get(id);
        if (!entry || !entry.related) continue;

        for (const rel of entry.related) {
          if (foundIds.has(rel.id)) continue;

          const linkedEntry = entryMap.get(rel.id);
          if (!linkedEntry) continue;

          if (linkedEntry.type === 'decision' && linkedEntry.status === 'active') {
            warnings.push({
              entry_id: linkedEntry.id,
              title: linkedEntry.title,
              type: 'decision',
              reason: `Related to ${id} via [${rel.rel}] (depth ${depth + 1}) \u2014 active decision`
            });
            foundIds.add(linkedEntry.id);
            nextIds.push(linkedEntry.id);
          } else if (linkedEntry.type === 'bug' && linkedEntry.status === 'open') {
            warnings.push({
              entry_id: linkedEntry.id,
              title: linkedEntry.title,
              type: 'bug',
              reason: `Related to ${id} via [${rel.rel}] (depth ${depth + 1}) \u2014 open bug`
            });
            foundIds.add(linkedEntry.id);
            nextIds.push(linkedEntry.id);
          }
        }
      }
      idsToTraverse.length = 0;
      idsToTraverse.push(...nextIds);
    }

    return { conflicts, warnings };
  }
}
