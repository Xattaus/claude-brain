import { formatHealthReport } from '../utils/format-health.js';
import { AutoDocumenter } from '../auto-documenter.js';

export const maintenanceHandlers = {
  brain_update_entry: async (ctx, args) => {
    const { manager } = ctx;
    const updates = {};
    if (args.status) updates.status = args.status;
    if (args.title) updates.title = args.title;
    if (args.content) updates.content = args.content;
    if (args.add_related) updates.add_related = args.add_related;

    const updated = await manager.updateEntry(args.id, updates);
    if (!updated) {
      return [{ type: 'text', text: `Entry ${args.id} not found.` }];
    }

    // Set up bidirectional links for new relations
    if (args.add_related) {
      for (const rel of args.add_related) {
        try {
          await manager.linkEntries(args.id, rel.id, rel.rel);
        } catch {
          // skip
        }
      }
    }

    return [{ type: 'text', text: `Updated ${args.id}: ${Object.keys(updates).join(', ')}` }];
  },

  brain_get_history: async (ctx, args) => {
    const { manager } = ctx;
    const history = await manager.getHistory({
      since: args.since,
      limit: args.limit
    });
    return [{ type: 'text', text: history }];
  },

  brain_health: async (ctx, args) => {
    const { manager } = ctx;
    const stats = await manager.getHealthData(args.threshold_days || 30);
    return [{ type: 'text', text: formatHealthReport(stats) }];
  },

  brain_review_entry: async (ctx, args) => {
    const { manager } = ctx;
    const result = await manager.reviewEntry(args.id, args.notes);
    if (!result) {
      return [{ type: 'text', text: `Entry ${args.id} not found.` }];
    }
    return [{ type: 'text', text: `Reviewed ${result.id} \u2014 last_reviewed updated to ${result.last_reviewed}` }];
  },

  brain_auto_document: async (ctx, args) => {
    const { manager } = ctx;
    const documenter = new AutoDocumenter(manager);
    const since = args.since || '7 days ago';
    const dryRun = args.dry_run !== false;

    const result = await documenter.analyze(since, dryRun);

    let text = `## Auto-documentation ${dryRun ? '(dry run)' : ''}\n\n`;
    text += `Analyzed commits since: ${since}\n`;
    text += `Already documented: ${result.existing} commits\n\n`;

    if (result.suggestions.length === 0) {
      text += 'No undocumented changes found.\n';
    } else {
      text += `**${result.suggestions.length} suggestions:**\n\n`;
      for (const s of result.suggestions) {
        text += `### ${s.type.toUpperCase()}: ${s.title}\n`;
        text += `- Files: ${s.files.join(', ')}\n`;
        text += `- Commit: \`${s.sha?.substring(0, 8)}\` ${s.commitMessage}\n\n`;
      }
      if (dryRun) {
        text += '_Set dry_run=false to create these entries._\n';
      }
    }

    return [{ type: 'text', text }];
  }
};
