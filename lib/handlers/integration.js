// Integration handlers: sync, environment scanning, research recording

import { SyncEngine } from '../integrations/sync-engine.js';
import { EnvironmentScanner } from '../integrations/environment-scanner.js';
import { SessionIntegrator } from '../integrations/session-integrator.js';
import { AutoOverview } from '../auto-overview.js';

export const integrationHandlers = {
  brain_sync: async (ctx, args) => {
    const { manager } = ctx;
    const engine = new SyncEngine(manager);
    const results = await engine.runSync();

    let text = '## Sync Results\n\n';
    text += `- Created: ${results.created} entries\n`;
    text += `- Updated: ${results.updated} entries\n`;
    text += `- Unchanged: ${results.unchanged} entries\n`;

    if (results.created > 0 || results.updated > 0) {
      text += '\nBrain is now up-to-date with superpowers docs.';
    }

    return [{ type: 'text', text }];
  },

  brain_get_environment: async (ctx, args) => {
    const { manager } = ctx;
    const scanner = new EnvironmentScanner(manager.projectPath);
    const env = await scanner.scanAndSave(manager.brainPath);

    let text = '## Environment\n\n';

    if (env.mcp_servers.length > 0) {
      text += '### MCP Servers\n';
      for (const s of env.mcp_servers) {
        text += `- **${s.name}**\n`;
      }
      text += '\n';
    }

    if (env.skills.length > 0) {
      text += '### Available Skills\n';
      for (const s of env.skills) {
        text += `- **${s.name}**${s.description ? `: ${s.description}` : ''}\n`;
      }
      text += '\n';
    }

    if (env.custom_agents.length > 0) {
      text += '### Custom Agents\n';
      for (const a of env.custom_agents) {
        text += `- **${a.name}**${a.description ? `: ${a.description}` : ''}\n`;
      }
      text += '\n';
    }

    return [{ type: 'text', text }];
  },

  brain_scan_environment: async (ctx, args) => {
    const { manager } = ctx;
    const scanner = new EnvironmentScanner(manager.projectPath);
    const env = await scanner.scanAndSave(manager.brainPath);

    return [{ type: 'text', text: `Environment scanned: ${env.mcp_servers.length} MCP servers, ${env.skills.length} skills, ${env.custom_agents.length} agents.` }];
  },

  brain_record_research: async (ctx, args) => {
    const { manager, session } = ctx;
    const integrator = new SessionIntegrator(manager);
    const result = await integrator.recordResearch(args);

    session.trackChange('research', result.id, args.title);
    return [{ type: 'text', text: `Research recorded: ${result.id} → ${result.path}` }];
  }
};
