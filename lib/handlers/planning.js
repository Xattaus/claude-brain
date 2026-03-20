import { buildPlanBody } from '../utils/body-builders.js';

export const planningHandlers = {
  brain_record_plan: async (ctx, args) => {
    const { manager, session, t } = ctx;
    const relatedInput = args.related || [];
    const body = buildPlanBody(args, t);
    const result = await manager.createEntry({
      type: 'plan',
      prefix: 'PLAN',
      dirName: 'plans',
      title: args.title,
      frontmatter: {
        status: args.status || 'partial',
        priority: args.priority || 'medium',
        tags: args.tags || [],
        related: relatedInput,
        files: args.files || []
      },
      body
    });

    for (const rel of relatedInput) {
      try {
        await manager.linkEntries(result.id, rel.id, rel.rel);
      } catch {
        // skip
      }
    }

    session.trackChange('plan', result.id, args.title);
    return [{ type: 'text', text: `Plan recorded: ${result.id} \u2192 ${result.path}` }];
  },

  brain_get_backlog: async (ctx, args) => {
    const { manager } = ctx;
    const compact = args.compact || false;
    const index = await manager.loadIndex();
    const plans = index.entries.filter(e => e.type === 'plan');

    let filtered = plans;
    if (!args.include_completed) {
      filtered = plans.filter(e => e.status !== 'completed' && e.status !== 'abandoned');
    }

    if (filtered.length === 0) {
      return [{ type: 'text', text: 'No plans in backlog.' }];
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    filtered.sort((a, b) => (priorityOrder[a.priority || 'medium'] || 2) - (priorityOrder[b.priority || 'medium'] || 2));

    let text = `## Backlog (${filtered.length} plan${filtered.length > 1 ? 's' : ''})\n\n`;
    const now = Date.now();

    for (const plan of filtered) {
      const daysAgo = Math.round((now - new Date(plan.date).getTime()) / 86400000);
      const icon = { critical: '\ud83d\udd34', high: '\ud83d\udd34', medium: '\ud83d\udfe1', low: '\ud83d\udfe2' }[plan.priority || 'medium'] || '\ud83d\udfe1';
      const prio = (plan.priority || 'medium').toUpperCase();

      if (compact) {
        text += `- ${icon} **${plan.id}** [${prio}] ${plan.title} (${daysAgo}d)\n`;
      } else {
        text += `### ${icon} ${prio}: ${plan.id} \u2014 ${plan.title} (${daysAgo} days ago)\n`;
        text += `Status: ${plan.status}\n`;

        // Read file to show deferred items
        const entry = await manager.getEntry(plan.id);
        if (entry && entry.content) {
          const deferredMatch = entry.content.match(/## Deferred\n([\s\S]*?)(?=\n## |$)/);
          if (deferredMatch && deferredMatch[1].trim()) {
            text += `Deferred:\n${deferredMatch[1].trim()}\n`;
          }
          const nextMatch = entry.content.match(/## Next Steps\n([\s\S]*?)$/);
          if (nextMatch && nextMatch[1].trim()) {
            text += `Next: ${nextMatch[1].trim()}\n`;
          }
        }
        text += '\n';
      }
    }

    return [{ type: 'text', text }];
  },

  brain_update_plan: async (ctx, args) => {
    const { manager } = ctx;
    const entry = await manager.getEntry(args.id);
    if (!entry) {
      return [{ type: 'text', text: `Plan ${args.id} not found.` }];
    }

    let content = entry.content;
    const changes = [];

    // Move deferred items to implemented
    if (args.completed_items && args.completed_items.length > 0) {
      for (const completed of args.completed_items) {
        // Match deferred item line and mark as done
        const escapedItem = completed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const deferredRegex = new RegExp(`- \\[ \\] (.*${escapedItem}.*)`, 'i');
        const match = content.match(deferredRegex);
        if (match) {
          content = content.replace(match[0], `- [x] ${match[1]} \u2714`);
          // Also add to implemented section
          const implSection = content.match(/## Implemented\n([\s\S]*?)(?=\n## )/);
          if (implSection) {
            const idx = content.indexOf(implSection[0]);
            if (idx !== -1) {
              const insertPoint = idx + implSection[0].length;
              content = content.substring(0, insertPoint) + `\n- [x] ${match[1]}\n` + content.substring(insertPoint);
            }
          }
          changes.push(`completed: ${completed}`);
        }
      }
    }

    // Add new deferred items
    if (args.new_deferred && args.new_deferred.length > 0) {
      const deferredSection = content.indexOf('## Deferred');
      if (deferredSection !== -1) {
        const nextSection = content.indexOf('\n## ', deferredSection + 1);
        const insertPoint = nextSection !== -1 ? nextSection : content.length;
        let newItems = '';
        for (const d of args.new_deferred) {
          newItems += `- [ ] ${d.item} (reason: ${d.reason})\n`;
        }
        content = content.substring(0, insertPoint) + newItems + content.substring(insertPoint);
        changes.push(`deferred ${args.new_deferred.length} new items`);
      }
    }

    // Add new implemented items
    if (args.new_implemented && args.new_implemented.length > 0) {
      const implSection = content.indexOf('## Implemented');
      if (implSection !== -1) {
        const nextSection = content.indexOf('\n## ', implSection + 1);
        const insertPoint = nextSection !== -1 ? nextSection : content.length;
        let newItems = '';
        for (const item of args.new_implemented) {
          newItems += `- [x] ${item}\n`;
        }
        content = content.substring(0, insertPoint) + newItems + content.substring(insertPoint);
        changes.push(`implemented ${args.new_implemented.length} items`);
      }
    }

    // Update next_steps
    if (args.next_steps) {
      const nextSection = content.match(/## Next Steps\n[\s\S]*$/);
      if (nextSection) {
        content = content.replace(nextSection[0], `## Next Steps\n\n${args.next_steps}\n`);
        changes.push('updated next_steps');
      }
    }

    // Build updates for manager
    const updates = { content: content.replace(/^---[\s\S]*?---\n*/, '') };
    if (args.status) updates.status = args.status;

    await manager.updateEntry(args.id, updates);

    return [{ type: 'text', text: `Updated ${args.id}: ${changes.join(', ') || 'status updated'}` }];
  },

  brain_get_session_summary: async (ctx, args) => {
    const { session } = ctx;
    const sessionChanges = session.getChanges();

    if (sessionChanges.length === 0) {
      return [{ type: 'text', text: 'No brain changes in this session.' }];
    }

    let text = `## Session Summary (${sessionChanges.length} changes)\n\n`;
    const byType = {};
    for (const c of sessionChanges) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    }

    for (const [type, changes] of Object.entries(byType)) {
      text += `### ${type} (${changes.length})\n`;
      for (const c of changes) {
        text += `- **${c.id}**: ${c.title} (${c.timestamp})\n`;
      }
      text += '\n';
    }

    text += '\n_Include this summary in compact context to preserve session work._';
    return [{ type: 'text', text }];
  }
};
