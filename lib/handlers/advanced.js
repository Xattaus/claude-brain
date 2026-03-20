import { mineProjectContext } from '../conversation-miner.js';

export const advancedHandlers = {
  brain_mine_sessions: async (ctx, args) => {
    const { manager } = ctx;
    const daysBack = args.days_back || 30;
    const results = await mineProjectContext(
      manager.projectPath,
      args.file_paths,
      { daysBack, keywords: args.keywords || [] }
    );

    if (!results.found) {
      return [{ type: 'text', text: `No conversation logs found for this project.\n${results.reason || ''}` }];
    }

    if (results.sessions.length === 0) {
      return [{ type: 'text', text: `No sessions found mentioning these files in the last ${daysBack} days.\nSearched in: ${(results.searchedDirs || []).join(', ')}` }];
    }

    let output = `## Session Context Mining\n\n`;
    output += `**Searched files:** ${args.file_paths.join(', ')}\n`;
    if (args.keywords?.length > 0) output += `**Keywords:** ${args.keywords.join(', ')}\n`;
    output += `**Period:** last ${daysBack} days\n`;
    output += `**Sessions with matches:** ${results.sessions.length}\n\n`;

    for (const session of results.sessions) {
      output += `---\n### ${session.summary}\n`;
      output += `*${session.period.start} \u2014 ${session.period.end}*\n\n`;

      if (session.touchedFiles.length > 0) {
        output += `**Files modified in session:** ${session.touchedFiles.join(', ')}\n\n`;
      }

      for (const msg of session.relevantMessages) {
        const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        output += `**${roleLabel}** (${timeStr}, relevance: ${msg.score}):\n`;
        output += `> ${msg.text.replace(/\n/g, '\n> ')}\n\n`;
      }
    }

    return [{ type: 'text', text: output }];
  },

  brain_coordinate_team: async (ctx, args) => {
    const { manager } = ctx;
    const availableAgents = ['curator', 'documenter', 'reviewer', 'backlog'];
    const requestedAgents = args.agents || availableAgents;

    let text = `## Brain Team Coordination\n\n`;
    text += `Requested agents: ${requestedAgents.join(', ')}\n\n`;
    text += `To run a comprehensive brain maintenance, use these commands in order:\n\n`;

    for (const agent of requestedAgents) {
      switch (agent) {
        case 'curator':
          text += `### 1. Curator\n`;
          text += `Run: \`/agent brain-curator\`\n`;
          text += `Purpose: Clean stale entries, fix relationships, merge duplicates\n\n`;
          break;
        case 'documenter':
          text += `### 2. Documenter\n`;
          text += `Run: \`/agent brain-documenter\`\n`;
          text += `Purpose: Document undocumented code changes and architectural decisions\n\n`;
          break;
        case 'reviewer':
          text += `### 3. Reviewer\n`;
          text += `Run: \`/agent brain-reviewer\`\n`;
          text += `Purpose: Review entries for accuracy, mark stale ones, suggest updates\n\n`;
          break;
        case 'backlog':
          text += `### 4. Backlog\n`;
          text += `Run: \`/agent brain-backlog\`\n`;
          text += `Purpose: Review and prioritize incomplete plans, check for abandoned work\n\n`;
          break;
      }
    }

    // Include current health status as reference
    try {
      const health = await manager.getHealthData(30);
      text += `### Current Health Status\n`;
      text += `- Total entries: ${health.total}\n`;
      if (health.stale.length > 0) text += `- Stale: ${health.stale.length}\n`;
      if (health.orphaned.length > 0) text += `- Orphaned: ${health.orphaned.length}\n`;
      if (health.brokenLinks.length > 0) text += `- Broken links: ${health.brokenLinks.length}\n`;
      if (health.incompletePlans.length > 0) text += `- Incomplete plans: ${health.incompletePlans.length}\n`;
    } catch {
      // Health check failed, skip
    }

    return [{ type: 'text', text }];
  },

  brain_rebuild_index: async (ctx, args) => {
    const { manager } = ctx;
    const result = await manager.rebuildIndex();
    let text = `## Index Rebuilt\n\n`;
    text += `**Entries recovered:** ${result.entriesFound}\n\n`;
    text += `**Counters:**\n`;
    for (const [prefix, count] of Object.entries(result.counters)) {
      text += `- ${prefix}: ${count}\n`;
    }
    return [{ type: 'text', text }];
  },

  brain_get_metrics: async (ctx, args) => {
    const { metrics } = ctx;
    const report = await metrics.getReport();
    return [{ type: 'text', text: report }];
  },

  brain_create_snapshot: async (ctx, args) => {
    const { manager } = ctx;
    const result = await manager.createSnapshot(args.label);
    let text = `## Snapshot Created\n\n`;
    text += `**Timestamp:** ${result.timestamp}\n`;
    text += `**Entries:** ${result.entriesCount}\n`;
    text += `**Path:** ${result.path}\n\n`;
    text += `_Use brain_list_snapshots to see all snapshots, brain_restore_snapshot to restore._`;
    return [{ type: 'text', text }];
  },

  brain_list_snapshots: async (ctx, args) => {
    const { manager } = ctx;
    const snapshots = await manager.listSnapshots();
    if (snapshots.length === 0) {
      return [{ type: 'text', text: 'No snapshots found. Use `brain_create_snapshot` to create one.' }];
    }
    let text = `## Available Snapshots\n\n`;
    for (const s of snapshots) {
      text += `- **${s.name}** \u2014 ${s.timestamp} (${s.entriesCount} entries)`;
      if (s.label) text += ` [${s.label}]`;
      text += `\n`;
    }
    text += `\n_Use brain_restore_snapshot with the name to restore._`;
    return [{ type: 'text', text }];
  },

  brain_update: async (ctx, args) => {
    const { execSync } = await import('node:child_process');
    const { dirname, join: pathJoin } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __fn = fileURLToPath(import.meta.url);
    const __dn = dirname(__fn);
    const installScript = pathJoin(__dn, '..', '..', 'install.js');
    const projectPath = process.env.BRAIN_PROJECT_PATH;

    try {
      const output = execSync(`node "${installScript}" "${projectPath}" --update`, {
        encoding: 'utf-8',
        timeout: 30000
      });
      return [{ type: 'text', text: `## Brain Updated\n\n${output}` }];
    } catch (err) {
      return [{ type: 'text', text: `Error updating brain: ${err.message}\n${err.stdout || ''}` }];
    }
  },

  brain_visualize: async (ctx, args) => {
    const { fork } = await import('node:child_process');
    const { dirname, join: pathJoin } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __fn = fileURLToPath(import.meta.url);
    const __dn = dirname(__fn);
    const vizScript = pathJoin(__dn, '..', '..', 'visualize.js');
    const projectPath = process.env.BRAIN_PROJECT_PATH;

    try {
      // Fork the visualizer — it opens the browser itself
      const child = fork(vizScript, [projectPath], { silent: true });
      // Wait briefly for the server to start and capture the URL
      const url = await new Promise((resolve, reject) => {
        let output = '';
        child.stdout.on('data', (data) => { output += data.toString(); });
        child.stderr.on('data', (data) => { output += data.toString(); });
        setTimeout(() => {
          const match = output.match(/\u2192\s+(http:\/\/[^\s]+)/);
          if (match) resolve(match[1]);
          else resolve('http://127.0.0.1 (check terminal)');
        }, 2000);
      });
      // Detach so MCP server doesn't block
      child.unref();
      return [{ type: 'text', text: `## Brain Visualizer Launched\n\nOpened interactive knowledge graph in browser.\n\n**URL:** ${url}\n\nPress Ctrl+C in the terminal to stop the visualizer server.` }];
    } catch (err) {
      return [{ type: 'text', text: `Error launching visualizer: ${err.message}` }];
    }
  }
};
