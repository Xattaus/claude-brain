// Context handlers: check_conflicts, link_entries, get_context_for_files, traverse_graph

import { BrainGraph } from '../graph.js';

export const contextHandlers = {
  brain_check_conflicts: async (ctx, args) => {
    const { checker } = ctx;
    const { conflicts, warnings } = await checker.check(
      args.proposed_change,
      args.affected_files || []
    );

    if (conflicts.length === 0 && warnings.length === 0) {
      return [{ type: 'text', text: 'No conflicts found. Safe to proceed.' }];
    }

    let text = '';
    if (conflicts.length > 0) {
      text += `\u26a0 ${conflicts.length} CONFLICT(S):\n`;
      for (const c of conflicts) {
        text += `- **${c.entry_id}**: ${c.title}\n  Reason: ${c.reason}\n`;
      }
      text += '\n';
    }
    if (warnings.length > 0) {
      text += `\u2139 ${warnings.length} WARNING(S):\n`;
      for (const w of warnings) {
        text += `- **${w.entry_id}**: ${w.title}\n  Reason: ${w.reason}\n`;
      }
    }
    return [{ type: 'text', text }];
  },

  brain_link_entries: async (ctx, args) => {
    const { manager } = ctx;
    const result = await manager.linkEntries(args.from, args.to, args.rel);
    return [{ type: 'text', text: `Linked: ${result.from} \u2014[${result.rel}]\u2192 ${result.to} (inverse: ${result.inverseRel})` }];
  },

  brain_get_context_for_files: async (ctx, args) => {
    const { manager } = ctx;
    const compact = args.compact || false;
    const grouped = await manager.getContextForFiles(args.files);

    let text = `Context for files: ${args.files.join(', ')}\n\n`;
    let hasContent = false;

    if (grouped.decisions && grouped.decisions.length > 0) {
      hasContent = true;
      text += '## Active Decisions\n';
      for (const d of grouped.decisions) {
        text += `- **${d.id}**${compact ? '' : ` [${d.status}]`}: ${d.title}\n`;
      }
      text += '\n';
    }
    if (grouped.bugs && grouped.bugs.length > 0) {
      hasContent = true;
      text += '## Bugs\n';
      for (const b of grouped.bugs) {
        text += `- **${b.id}**${compact ? '' : ` [${b.status}]`}: ${b.title}\n`;
      }
      text += '\n';
    }
    if (grouped.implementations && grouped.implementations.length > 0) {
      hasContent = true;
      text += '## Implementations\n';
      for (const i of grouped.implementations) {
        text += `- **${i.id}**${compact ? '' : ` [${i.status}]`}: ${i.title}\n`;
      }
      text += '\n';
    }
    if (grouped.patterns && grouped.patterns.length > 0) {
      hasContent = true;
      text += '## Patterns\n';
      for (const p of grouped.patterns) {
        text += `- **${p.id}**: ${p.title}\n`;
      }
      text += '\n';
    }
    if (grouped.lessons && grouped.lessons.length > 0) {
      hasContent = true;
      text += '## Lessons\n';
      for (const l of grouped.lessons) {
        text += `- **${l.id}**: ${l.title}\n`;
      }
      text += '\n';
    }

    if (!hasContent) {
      text += 'No brain context found for these files.';
    }
    if (compact && hasContent) {
      text += '_Use brain_get_entry for full details._';
    }

    return [{ type: 'text', text }];
  },

  brain_traverse_graph: async (ctx, args) => {
    const { manager } = ctx;
    const graph = new BrainGraph(manager);
    const mode = args.mode;

    if (mode === 'traverse') {
      if (!args.start_id) return [{ type: 'text', text: 'start_id is required for traverse mode' }];
      const result = await graph.traverse(args.start_id, {
        maxDepth: args.max_depth || 3,
        relTypes: args.rel_types
      });
      let text = `## Graph traversal from ${args.start_id} (depth ${args.max_depth || 3})\n\n`;
      text += `**Nodes (${result.nodes.length}):**\n`;
      for (const node of result.nodes) {
        const indent = '  '.repeat(node.depth);
        text += `${indent}- **${node.id}** [${node.type}/${node.status}] ${node.title}\n`;
      }
      text += `\n**Edges (${result.edges.length}):**\n`;
      for (const edge of result.edges) {
        text += `- ${edge.from} \u2014[${edge.rel}]\u2192 ${edge.to}\n`;
      }
      return [{ type: 'text', text }];
    }

    if (mode === 'path') {
      if (!args.start_id || !args.target_id) return [{ type: 'text', text: 'start_id and target_id are required for path mode' }];
      const path = await graph.findPath(args.start_id, args.target_id);
      if (path.length === 0) {
        return [{ type: 'text', text: `No path found between ${args.start_id} and ${args.target_id}` }];
      }
      let text = `## Path: ${args.start_id} \u2192 ${args.target_id}\n\n`;
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        text += `${i + 1}. **${p.id}** ${p.title}`;
        if (p.rel) text += ` \u2014[${p.rel}]\u2192`;
        text += '\n';
      }
      return [{ type: 'text', text }];
    }

    if (mode === 'impact') {
      if (!args.start_id) return [{ type: 'text', text: 'start_id is required for impact mode' }];
      const dependents = await graph.dependents(args.start_id, args.max_depth || 3);
      let text = `## Impact analysis for ${args.start_id}\n\n`;
      if (dependents.length === 0) {
        text += 'No dependent entries found.\n';
      } else {
        text += `**${dependents.length} dependent entries:**\n`;
        for (const dep of dependents) {
          text += `- **${dep.id}** [${dep.type}/${dep.status}] ${dep.title} (via ${dep.rel}, depth ${dep.depth})\n`;
        }
      }
      return [{ type: 'text', text }];
    }

    if (mode === 'cycles') {
      const cycles = await graph.findCycles();
      let text = '## Cycle detection\n\n';
      if (cycles.length === 0) {
        text += 'No cycles found. Graph is acyclic.\n';
      } else {
        text += `**${cycles.length} cycles found:**\n`;
        for (const cycle of cycles) {
          text += `- ${cycle.join(' \u2192 ')}\n`;
        }
      }
      return [{ type: 'text', text }];
    }

    return [{ type: 'text', text: `Unknown mode: ${mode}` }];
  }
};
