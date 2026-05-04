// Core handlers: overview, search, get_entry, list, get_lessons

import { SyncEngine } from '../integrations/sync-engine.js';
import { AutoOverview } from '../auto-overview.js';

export const coreHandlers = {
  brain_get_overview: async (ctx, args) => {
    const { manager } = ctx;

    // Auto-sync superpowers docs and regenerate overview if stale
    try {
      const syncEngine = new SyncEngine(manager);
      if (await syncEngine.needsSync()) {
        await syncEngine.runSync();
      }
      const autoOverview = new AutoOverview(manager);
      await autoOverview.generateAndSave();
    } catch (err) {
      process.stderr.write(`[brain] Auto-sync warning: ${err.message}\n`);
    }

    const compact = args.compact || false;
    const overview = await manager.getOverview();
    const manifest = await manager.loadManifest();
    const decisions = await manager.listEntries({ type: 'decision', status: 'active' });
    const openBugs = await manager.listEntries({ type: 'bug', status: 'open' });
    const activeLessons = await manager.listEntries({ type: 'lesson', status: 'active' });

    let result = '';

    if (compact) {
      result += overview.substring(0, 500) + (overview.length > 500 ? '\n...(truncated, call without compact for full)' : '') + '\n\n';
    } else {
      result += overview + '\n\n';
    }

    // Show project paths from manifest
    if (manifest.paths && manifest.paths.length > 1) {
      result += '## Project Paths\n';
      for (const { path, label } of manifest.paths) {
        result += `- **${label}**: \`${path}\`\n`;
      }
      result += '\n';
    }

    if (decisions.length > 0) {
      result += '## Active Decisions\n';
      for (const d of decisions) {
        result += `- **${d.id}**: ${d.title}\n`;
      }
      result += '\n';
    }
    if (openBugs.length > 0) {
      result += '## Open Bugs\n';
      for (const b of openBugs) {
        result += `- **${b.id}**: ${b.title}\n`;
      }
      result += '\n';
    }
    if (activeLessons.length > 0) {
      result += `## Lessons (${activeLessons.length})\n`;
      result += '_Call brain_get_lessons for full rules._\n';
      for (const l of activeLessons) {
        result += `- **${l.id}**: ${l.title}\n`;
      }
      result += '\n';
    }

    // Health warnings (always included even in compact)
    try {
      const health = await manager.getHealthData(30);
      const warnings = [];
      if (health.stale.length > 0) warnings.push(`\u26a0 ${health.stale.length} stale entries`);
      if (health.orphaned.length > 0) warnings.push(`\u26a0 ${health.orphaned.length} orphans`);
      if (health.brokenLinks.length > 0) warnings.push(`\u274c ${health.brokenLinks.length} broken links`);
      if (health.oldOpenBugs.length > 0) warnings.push(`\u26a0 ${health.oldOpenBugs.length} old open bugs`);

      if (warnings.length > 0) {
        result += '## Health Warnings\n';
        for (const w of warnings) {
          result += `- ${w}\n`;
        }
        result += 'Run `brain_health` for details.\n\n';
      }

      // Backlog summary
      const incompletePlans = health.incompletePlans || [];
      if (incompletePlans.length > 0) {
        const byPrio = {};
        for (const p of incompletePlans) {
          const prio = p.priority || 'medium';
          byPrio[prio] = (byPrio[prio] || 0) + 1;
        }
        const prioSummary = Object.entries(byPrio).map(([k, v]) => `${v} ${k}`).join(', ');
        result += '## Backlog\n';
        result += `- ${incompletePlans.length} incomplete plans (${prioSummary})\n`;
        result += 'Run `brain_get_backlog` for details.\n\n';
      }
    } catch {
      // Health check failed silently
    }

    // Token-aware truncation
    const maxTokens = args.max_tokens;
    if (maxTokens && result.length > maxTokens) {
      let healthSection = '';
      try {
        const health = await manager.getHealthData(30);
        const warnings = [];
        if (health.stale.length > 0) warnings.push(`\u26a0 ${health.stale.length} stale entries`);
        if (health.brokenLinks.length > 0) warnings.push(`\u274c ${health.brokenLinks.length} broken links`);
        if (warnings.length > 0) {
          healthSection = '## Health Warnings\n' + warnings.map(w => `- ${w}`).join('\n') + '\n\n';
        }
      } catch { /* skip */ }

      const decisionsSection = decisions.length > 0
        ? '## Active Decisions\n' + decisions.map(d => `- **${d.id}**: ${d.title}`).join('\n') + '\n\n'
        : '';
      const bugsSection = openBugs.length > 0
        ? '## Open Bugs\n' + openBugs.map(b => `- **${b.id}**: ${b.title}`).join('\n') + '\n\n'
        : '';

      const fixedLen = healthSection.length + decisionsSection.length + bugsSection.length;
      const overviewBudget = Math.max(100, maxTokens - fixedLen);
      const truncatedOverview = overview.substring(0, overviewBudget) +
        (overview.length > overviewBudget ? '\n...(truncated, call without max_tokens for full)' : '');

      result = truncatedOverview + '\n\n' + healthSection + decisionsSection + bugsSection;
    }

    return [{ type: 'text', text: result }];
  },

  brain_search: async (ctx, args) => {
    const { search } = ctx;
    const compact = args.compact || false;
    const results = await search.search(args.query, {
      type: args.type,
      tags: args.tags
    });

    if (results.length === 0) {
      return [{ type: 'text', text: `No results for "${args.query}"` }];
    }

    let text = `Found ${results.length} result(s) for "${args.query}":\n\n`;
    for (const r of results) {
      if (compact) {
        text += `- **${r.id}** [${r.type}] ${r.title}\n`;
      } else {
        text += `### ${r.id}: ${r.title}\n`;
        text += `Type: ${r.type} | Status: ${r.status} | Tags: ${(Array.isArray(r.tags) ? r.tags : []).join(', ')}`;
        if (r.score) text += ` | Score: ${r.score.toFixed(1)}`;
        text += '\n';
        if (r.snippet) text += `> ${r.snippet}\n`;
        text += '\n';
      }
    }
    if (compact) text += '\n_Use brain_get_entry for details._';
    return [{ type: 'text', text }];
  },

  brain_get_entry: async (ctx, args) => {
    const { manager } = ctx;
    const entry = await manager.getEntry(args.id);
    if (!entry) {
      return [{ type: 'text', text: `Entry ${args.id} not found.` }];
    }

    let text = entry.content;

    // Add relationships section with resolved titles
    const index = await manager.loadIndex();
    const indexEntry = index.entries.find(e => e.id === args.id);
    if (indexEntry && indexEntry.related && indexEntry.related.length > 0) {
      text += '\n\n## Relationships\n';
      for (const rel of indexEntry.related) {
        const relatedEntry = index.entries.find(e => e.id === rel.id);
        const title = relatedEntry ? relatedEntry.title : '(unknown)';
        text += `- **${rel.id}** [${rel.rel}]: ${title}\n`;
      }
    }

    return [{ type: 'text', text }];
  },

  brain_list: async (ctx, args) => {
    const { manager } = ctx;
    const compact = args.compact || false;
    const entries = await manager.listEntries({
      type: args.type,
      status: args.status,
      tags: args.tags
    });

    if (entries.length === 0) {
      return [{ type: 'text', text: 'No entries found matching criteria.' }];
    }

    let text = `${entries.length} entries:\n\n`;
    for (const e of entries) {
      if (compact) {
        text += `- **${e.id}** ${e.title}\n`;
      } else {
        text += `- **${e.id}** [${e.type}/${e.status}] ${e.title} (${e.date}) [${(Array.isArray(e.tags) ? e.tags : []).join(', ')}]\n`;
      }
    }
    return [{ type: 'text', text }];
  },

  brain_get_lessons: async (ctx, args) => {
    const { manager } = ctx;
    const compact = args.compact || false;
    const index = await manager.loadIndex();
    let lessons = index.entries.filter(e => e.type === 'lesson' && e.status === 'active');

    // Filter by severity
    if (args.severity) {
      lessons = lessons.filter(e => e.severity === args.severity);
    }

    // Filter by tags
    if (args.tags && args.tags.length > 0) {
      const tagSet = new Set(args.tags.map(t => t.toLowerCase()));
      lessons = lessons.filter(e =>
        Array.isArray(e.tags) && e.tags.some(t => tagSet.has(t.toLowerCase()))
      );
    }

    if (lessons.length === 0) {
      return [{ type: 'text', text: 'No active lessons found.' }];
    }

    // Sort by severity: high -> medium -> low
    const severityOrder = { high: 0, medium: 1, low: 2 };
    lessons.sort((a, b) => (severityOrder[a.severity || 'medium'] || 1) - (severityOrder[b.severity || 'medium'] || 1));

    let text = `## Lessons Learned (${lessons.length})\n\n`;

    if (compact) {
      for (const lesson of lessons) {
        const entry = await manager.getEntry(lesson.id);
        let rule = '';
        if (entry && entry.content) {
          const ruleMatch = entry.content.match(/## (?:Sääntö|Rule)\n([\s\S]*?)(?=\n## |$)/);
          if (ruleMatch) rule = ruleMatch[1].trim();
        }
        const icon = { high: '\ud83d\udd34', medium: '\ud83d\udfe1', low: '\ud83d\udfe2' }[lesson.severity || 'medium'] || '\ud83d\udfe1';
        text += `- ${icon} **${lesson.id}**: ${rule || lesson.title}\n`;
      }
    } else {
      for (const lesson of lessons) {
        const icon = { high: '\ud83d\udd34', medium: '\ud83d\udfe1', low: '\ud83d\udfe2' }[lesson.severity || 'medium'] || '\ud83d\udfe1';
        text += `### ${icon} ${lesson.id}: ${lesson.title}\n`;
        text += `Severity: ${(lesson.severity || 'medium').toUpperCase()} | Trigger: ${lesson.trigger || 'correction'} | Tags: ${(Array.isArray(lesson.tags) ? lesson.tags : []).join(', ')}\n`;

        const entry = await manager.getEntry(lesson.id);
        if (entry && entry.content) {
          const ruleMatch = entry.content.match(/## (?:Sääntö|Rule)\n([\s\S]*?)(?=\n## |$)/);
          if (ruleMatch) text += `**Rule:** ${ruleMatch[1].trim()}\n`;
        }
        text += '\n';
      }
    }

    return [{ type: 'text', text }];
  }
};
