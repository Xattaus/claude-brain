/**
 * RuleExtractor + RuleIndex — Cognitive Firewall rule management
 *
 * Extracts machine-readable rules from brain entries (lessons, decisions, bugs, patterns)
 * and maintains a file→rules index for fast lookup.
 */

// ── Rule extraction patterns ──

const EXPLICIT_MARKERS = [
  { pattern: /^(?:RULE|SÄÄNTÖ):\s*(.+)$/gim, type: 'DO' },
  { pattern: /^(?:ALWAYS|AINA):\s*(.+)$/gim, type: 'DO' },
  { pattern: /^(?:DO|TEE):\s*(.+)$/gim, type: 'DO' },
  { pattern: /^(?:NEVER|ÄLÄ|DON'T):\s*(.+)$/gim, type: 'DONT' },
];

/**
 * RuleExtractor — Extracts rules from brain entry markdown content
 */
export class RuleExtractor {
  /**
   * Extract all rules from a brain entry
   * @param {object} entry - Index entry (id, type, title, status, severity, files, tags)
   * @param {string} content - Full markdown content of the entry
   * @returns {Array<object>} Extracted rules
   */
  extract(entry, content) {
    const rules = [];
    let counter = 1;

    const makeId = () => `RULE-${entry.id}-${counter++}`;
    const baseMeta = {
      source_id: entry.id,
      source_type: entry.type,
      files: entry.files || [],
      tags: entry.tags || [],
      severity: entry.severity || 'medium'
    };

    // 1. Explicit markers (highest confidence)
    for (const { pattern, type } of EXPLICIT_MARKERS) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        rules.push({
          id: makeId(),
          ...baseMeta,
          text: match[1].trim(),
          type
        });
      }
    }

    // 2. Structural: bullet lists under ## Sääntö / ## Rule sections
    const sectionPattern = /## (?:Sääntö|Rule)\n([\s\S]*?)(?=\n## |$)/gi;
    let sectionMatch;
    while ((sectionMatch = sectionPattern.exec(content)) !== null) {
      const sectionBody = sectionMatch[1];
      const bullets = sectionBody.match(/^[-*]\s+(.+)$/gm);
      if (bullets) {
        for (const bullet of bullets) {
          const text = bullet.replace(/^[-*]\s+/, '').trim();
          // Skip if already captured as explicit marker
          if (rules.some(r => r.text === text)) continue;
          rules.push({
            id: makeId(),
            ...baseMeta,
            text,
            type: 'DO'
          });
        }
      }
    }

    // 3. Implicit: lesson rule field stored in index
    if (entry.type === 'lesson' && entry.rule) {
      // Check if rule text is already captured
      if (!rules.some(r => r.text === entry.rule)) {
        rules.push({
          id: makeId(),
          ...baseMeta,
          text: entry.rule,
          type: 'DO'
        });
      }
    }

    // 4. Implicit: fixed bugs → GUARD rules
    if (entry.type === 'bug' && entry.status === 'fixed') {
      rules.push({
        id: makeId(),
        ...baseMeta,
        text: `Do not reintroduce: ${entry.title}`,
        type: 'GUARD'
      });
    }

    // 5. Implicit: open critical/high bugs → WARNING rules
    if (entry.type === 'bug' && entry.status === 'open' &&
        (entry.severity === 'critical' || entry.severity === 'high')) {
      rules.push({
        id: makeId(),
        ...baseMeta,
        text: `Open bug: ${entry.title}`,
        type: 'DONT'
      });
    }

    return rules;
  }
}

/**
 * RuleIndex — Manages file→rules mapping with O(1) lookup
 */
export class RuleIndex {
  constructor() {
    this.extractor = new RuleExtractor();
    this._version = 0;
    this._byFile = {};   // normalized filename → rules[]
    this._global = [];    // rules without file association
  }

  /**
   * Get rules relevant to given files
   * @param {string[]} files - File paths to look up
   * @returns {object[]} Matching rules (deduplicated)
   */
  getRulesForFiles(files) {
    const seen = new Set();
    const result = [];

    // Add global rules
    for (const rule of this._global) {
      if (!seen.has(rule.id)) {
        seen.add(rule.id);
        result.push(rule);
      }
    }

    // Add file-specific rules using suffix matching
    const normalizedInput = files.map(f => normalizePath(f));

    for (const [indexedFile, rules] of Object.entries(this._byFile)) {
      const matches = normalizedInput.some(np => {
        if (np === indexedFile) return true;
        // Suffix match with segment boundary
        if (np.endsWith(indexedFile)) {
          const charBefore = np[np.length - indexedFile.length - 1];
          return charBefore === '/' || charBefore === undefined;
        }
        if (indexedFile.endsWith(np)) {
          const charBefore = indexedFile[indexedFile.length - np.length - 1];
          return charBefore === '/' || charBefore === undefined;
        }
        return false;
      });

      if (matches) {
        for (const rule of rules) {
          if (!seen.has(rule.id)) {
            seen.add(rule.id);
            result.push(rule);
          }
        }
      }
    }

    return result;
  }

  /**
   * Rebuild the entire rule index from all entries
   * @param {object[]} entries - All index entries
   * @param {function} getContent - async (entry) => string, reads entry content
   * @returns {{ totalRules: number, doCount: number, dontCount: number, guardCount: number, filesCovered: number }}
   */
  async rebuild(entries, getContent) {
    this._byFile = {};
    this._global = [];
    this._version++;

    for (const entry of entries) {
      let content = '';
      try {
        content = await getContent(entry);
      } catch { /* skip unreadable entries */ }
      this._addRules(entry, content);
    }

    return this._getStats();
  }

  /**
   * Add rules for a single entry (incremental)
   * @param {object} entry - Index entry
   * @param {string} content - Entry markdown content
   */
  addRulesForEntry(entry, content) {
    this._addRules(entry, content);
    this._version++;
  }

  /**
   * Serialize the rule index for storage in index.json
   * @returns {object} Serializable rules object
   */
  serialize() {
    return {
      _version: this._version,
      byFile: { ...this._byFile },
      global: [...this._global]
    };
  }

  /**
   * Load from serialized data (e.g. from index.json)
   * @param {object} data - Serialized rules object
   */
  deserialize(data) {
    if (!data) return;
    this._version = data._version || 0;
    this._byFile = data.byFile || {};
    this._global = data.global || [];
  }

  // ── Internal ──

  _addRules(entry, content) {
    const rules = this.extractor.extract(entry, content);

    for (const rule of rules) {
      if (rule.files && rule.files.length > 0) {
        for (const file of rule.files) {
          const norm = normalizePath(file);
          if (!this._byFile[norm]) this._byFile[norm] = [];
          this._byFile[norm].push(rule);
        }
      } else {
        this._global.push(rule);
      }
    }
  }

  _getStats() {
    const allRules = [...this._global];
    for (const rules of Object.values(this._byFile)) {
      allRules.push(...rules);
    }
    // Deduplicate by ID
    const unique = new Map();
    for (const r of allRules) {
      unique.set(r.id, r);
    }
    const all = [...unique.values()];

    return {
      totalRules: all.length,
      doCount: all.filter(r => r.type === 'DO').length,
      dontCount: all.filter(r => r.type === 'DONT').length,
      guardCount: all.filter(r => r.type === 'GUARD').length,
      filesCovered: Object.keys(this._byFile).length
    };
  }
}

// ── Helpers ──

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * Calculate risk score for a set of context data
 */
export function calculateRiskScore({ activeDecisions = [], openBugs = [], fixedBugs = [], rules = [], conflicts = [], warnings = [], lessons = [] }) {
  let score = 0;

  score += activeDecisions.length * 10;

  const severityScores = { critical: 25, high: 15, medium: 8, low: 4 };
  for (const bug of openBugs) {
    score += severityScores[bug.severity || 'medium'] || 8;
  }

  const fixedSeverityScores = { critical: 20, high: 12, medium: 6, low: 3 };
  for (const bug of fixedBugs) {
    score += fixedSeverityScores[bug.severity || 'medium'] || 6;
  }

  score += rules.filter(r => r.type === 'DONT' || r.type === 'GUARD').length * 5;
  score += conflicts.length * 15;
  score += warnings.length * 3;
  score += lessons.filter(l => l.severity === 'high').length * 5;

  return Math.min(100, Math.max(0, score));
}

export function riskLabel(score) {
  if (score < 15) return 'SAFE';
  if (score < 40) return 'LOW';
  if (score < 70) return 'MEDIUM';
  return 'HIGH';
}
