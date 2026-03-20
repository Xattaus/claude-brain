#!/usr/bin/env node

/**
 * Claude Brain CLI Wrapper (ent. Gemini Brain)
 * Adapts the Claude Brain MCP tools for command-line usage.
 * 
 * Usage:
 *   node cli.js <command> [args]
 */

import { BrainManager } from './lib/brain-manager.js';
import { BrainSearch } from './lib/search.js';
import { ConflictChecker } from './lib/conflict-checker.js';
import { resolve } from 'path';

// Initialize brain components
const projectPath = process.env.PROJECT_PATH || process.cwd();
const manager = new BrainManager(projectPath);
const search = new BrainSearch(manager);
const checker = new ConflictChecker(manager);

async function main() {
  const [, , command, ...args] = process.argv;

  try {
    switch (command) {
      case 'overview':
        await cmdOverview(args);
        break;
      case 'search':
        await cmdSearch(args);
        break;
      case 'list':
        await cmdList(args);
        break;
      case 'read':
      case 'get':
        await cmdGet(args);
        break;
      case 'decide':
        await cmdDecide(args);
        break;
      case 'log-bug':
        await cmdLogBug(args);
        break;
      case 'implement':
        await cmdImplement(args);
        break;
      case 'check':
        await cmdCheck(args);
        break;
      case 'link':
        await cmdLink(args);
        break;
      case 'health':
        await cmdHealth(args);
        break;
      case 'update':
        await cmdUpdate();
        break;
      case 'snapshot':
        await cmdSnapshot(args);
        break;
      case 'metrics':
        await cmdMetrics();
        break;
      case 'rebuild':
        await cmdRebuild();
        break;
      case 'visualize':
      case 'viz':
      case 'graph':
        await cmdVisualize();
        break;
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// -- Command Implementations --

async function cmdOverview(args) {
  const compact = args.includes('--compact');

  // Reuse logic from mcp-server.js/handleTool/brain_get_overview
  const overview = await manager.getOverview();
  const manifest = await manager.loadManifest();
  const decisions = await manager.listEntries({ type: 'decision', status: 'active' });
  const openBugs = await manager.listEntries({ type: 'bug', status: 'open' });

  let result = '';

  if (compact) {
    result += overview.substring(0, 500) + (overview.length > 500 ? '\n...(truncated, call without --compact for full)' : '') + '\n\n';
  } else {
    result += overview + '\n\n';
  }

  if (manifest.paths && manifest.paths.length > 1) {
    result += '## Project Locations\n';
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

  // Health
  try {
    const health = await manager.getHealthData(30);
    const warnings = [];
    if (health.stale.length > 0) warnings.push(`⚠️ ${health.stale.length} stale entries`);
    if (health.orphaned.length > 0) warnings.push(`⚠️ ${health.orphaned.length} orphans`);
    if (health.brokenLinks.length > 0) warnings.push(`❌ ${health.brokenLinks.length} broken links`);
    if (health.oldOpenBugs.length > 0) warnings.push(`⚠️ ${health.oldOpenBugs.length} old open bugs`);

    if (warnings.length > 0) {
      result += '## Health Warnings\n';
      for (const w of warnings) {
        result += `- ${w}\n`;
      }
      result += 'Run `node cli.js health` for details.\n';
    }
  } catch { }

  console.log(result);
}

async function cmdSearch(args) {
  // Parse simple args: query is everything that's not a flag
  const typeFlag = args.find(a => a.startsWith('--type='));
  const type = typeFlag ? typeFlag.split('=')[1] : undefined;

  const query = args.filter(a => !a.startsWith('--')).join(' ');

  const results = await search.search(query, { type });

  if (results.length === 0) {
    console.log(`No results for "${query}"`);
    return;
  }

  console.log(`Found ${results.length} result(s) for "${query}":\n`);
  for (const r of results) {
    console.log(`### ${r.id}: ${r.title}`);
    console.log(`Type: ${r.type} | Status: ${r.status} | Tags: ${(Array.isArray(r.tags) ? r.tags : []).join(', ')}`);
    if (r.snippet) console.log(`> ${r.snippet}`);
    console.log('');
  }
}

async function cmdList(args) {
  const typeFlag = args.find(a => a.startsWith('--type='));
  const statusFlag = args.find(a => a.startsWith('--status='));

  const type = typeFlag ? typeFlag.split('=')[1] : undefined;
  const status = statusFlag ? statusFlag.split('=')[1] : undefined;

  const entries = await manager.listEntries({ type, status });

  if (entries.length === 0) {
    console.log('No entries found matching criteria.');
    return;
  }

  console.log(`${entries.length} entries:\n`);
  for (const e of entries) {
    console.log(`- **${e.id}** [${e.type}/${e.status}] ${e.title} (${e.date})`);
  }
}

async function cmdGet(args) {
  const id = args[0];
  if (!id) {
    console.error('Error: ID required');
    return;
  }

  const entry = await manager.getEntry(id);
  if (!entry) {
    console.error(`Entry ${id} not found.`);
    return;
  }

  console.log(entry.content);

  // Relationships
  const index = await manager.loadIndex();
  const indexEntry = index.entries.find(e => e.id === id);
  if (indexEntry && indexEntry.related && indexEntry.related.length > 0) {
    console.log('\n## Relationships');
    for (const rel of indexEntry.related) {
      const relatedEntry = index.entries.find(e => e.id === rel.id);
      const title = relatedEntry ? relatedEntry.title : '(unknown)';
      console.log(`- **${rel.id}** [${rel.rel}]: ${title}`);
    }
  }
}

async function cmdDecide(args) {
  // Simple usage: "Title of decision" "Context" "Decision"
  // For complex usage, modifying the file manually is often better, or we parse flags.
  // Here we take positional args for simplicity.
  const [title, context, decision] = args;

  if (!title || !context || !decision) {
    console.log('Usage: node cli.js decide "Title" "Context" "Decision"');
    console.log('For complex entries, creates a skeleton you can edit.');
    return;
  }

  const result = await manager.createEntry({
    type: 'decision',
    prefix: 'DEC',
    dirName: 'decisions',
    title: title,
    frontmatter: {
      status: 'active',
      context: `"${manager.escapeYaml(context)}"`,
      decision: `"${manager.escapeYaml(decision)}"`
    },
    body: `\n## Context\n${context}\n\n## Decision\n${decision}\n`
  });

  console.log(`Decision recorded: ${result.id} -> ${result.path}`);
}

async function cmdLogBug(args) {
  const [title, symptoms, fix] = args;

  if (!title || !symptoms || !fix) {
    console.log('Usage: node cli.js log-bug "Title" "Symptoms" "Fix"');
    return;
  }

  const result = await manager.createEntry({
    type: 'bug',
    prefix: 'BUG',
    dirName: 'bugs',
    title: title,
    frontmatter: {
      status: 'fixed',
      symptoms: `"${manager.escapeYaml(symptoms)}"`,
      fix: `"${manager.escapeYaml(fix)}"`
    },
    body: `\n## Symptoms\n${symptoms}\n\n## Fix\n${fix}\n`
  });

  console.log(`Bug recorded: ${result.id} -> ${result.path}`);
}

async function cmdImplement(args) {
  const [title, description] = args;

  if (!title || !description) {
    console.log('Usage: node cli.js implement "Title" "Description"');
    return;
  }

  const result = await manager.createEntry({
    type: 'implementation',
    prefix: 'IMPL',
    dirName: 'implementations',
    title: title,
    frontmatter: {
      status: 'current',
      description: `"${manager.escapeYaml(description)}"`
    },
    body: `\n## Description\n${description}\n`
  });

  console.log(`Implementation recorded: ${result.id} -> ${result.path}`);
}

async function cmdCheck(args) {
  const proposedChange = args.join(' ');
  if (!proposedChange) {
    console.log('Usage: node cli.js check "Description of proposed change"');
    return;
  }

  const { conflicts, warnings } = await checker.check(proposedChange, []);

  if (conflicts.length === 0 && warnings.length === 0) {
    console.log('No conflicts found. Safe to proceed.');
    return;
  }

  if (conflicts.length > 0) {
    console.log(`⚠️ ${conflicts.length} CONFLICT(S):`);
    for (const c of conflicts) {
      console.log(`- **${c.entry_id}**: ${c.title}\n  Reason: ${c.reason}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`ℹ️ ${warnings.length} Warning(s):`);
    for (const w of warnings) {
      console.log(`- **${w.entry_id}**: ${w.title}\n  Reason: ${w.reason}`);
    }
  }
}

async function cmdLink(args) {
  const [from, to, rel] = args;
  if (!from || !to || !rel) {
    console.log('Usage: node cli.js link <FROM_ID> <TO_ID> <RELATION>');
    console.log('Relations: supersedes, implements, fixes, relates_to');
    return;
  }

  try {
    await manager.linkEntries(from, to, rel);
    console.log(`Linked ${from} -[${rel}]-> ${to}`);
  } catch (e) {
    console.error(`Link failed: ${e.message}`);
  }
}

async function cmdHealth(args) {
  const health = await manager.getHealthData(30);
  console.log(JSON.stringify(health, null, 2));
}

async function cmdUpdate() {
  const { execSync } = await import('node:child_process');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __fn = fileURLToPath(import.meta.url);
  const __dn = dirname(__fn);
  const installScript = join(__dn, 'install.js');

  console.log(`🔄 Päivitetään aivot: ${projectPath}\n`);
  try {
    execSync(`node "${installScript}" "${projectPath}" --update`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Update failed: ${err.message}`);
    process.exit(1);
  }
}

async function cmdSnapshot(args) {
  const [action, ...rest] = args;

  if (!action || action === 'list') {
    const snapshots = await manager.listSnapshots();
    if (snapshots.length === 0) {
      console.log('No snapshots. Create one: node cli.js snapshot create [label]');
      return;
    }
    console.log(`${snapshots.length} snapshot(s):\n`);
    for (const s of snapshots) {
      console.log(`  ${s.name}  (${s.entriesCount} entries)${s.label ? ` [${s.label}]` : ''}`);
    }
  } else if (action === 'create') {
    const label = rest.join(' ') || undefined;
    const result = await manager.createSnapshot(label);
    console.log(`✓ Snapshot created: ${result.entriesCount} entries`);
  } else if (action === 'restore') {
    const name = rest[0];
    if (!name) { console.error('Usage: node cli.js snapshot restore <name>'); return; }
    const result = await manager.restoreSnapshot(name);
    console.log(`✓ Restored from ${name}: ${result.entriesCount} entries`);
  } else {
    console.log('Usage: node cli.js snapshot [list|create [label]|restore <name>]');
  }
}

async function cmdMetrics() {
  const { BrainMetrics } = await import('./lib/metrics.js');
  const { join } = await import('node:path');
  const metrics = new BrainMetrics(join(projectPath, '.brain'));
  console.log(await metrics.getReport());
}

async function cmdRebuild() {
  console.log('🔧 Rebuilding index.json from .brain/ files...\n');
  const result = await manager.rebuildIndex();
  console.log(`✓ ${result.entriesFound} entries recovered`);
  for (const [prefix, count] of Object.entries(result.counters)) {
    console.log(`  ${prefix}: ${count}`);
  }
}

async function cmdVisualize() {
  // Find visualize.js relative to this CLI script
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { existsSync } = await import('node:fs');
  const { fork } = await import('node:child_process');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const vizScript = join(__dirname, 'visualize.js');

  if (!existsSync(vizScript)) {
    console.error('Error: visualize.js not found at ' + vizScript);
    process.exit(1);
  }

  // Fork visualize.js with the current project path
  const child = fork(vizScript, [projectPath], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
}

function showHelp() {
  console.log(`
Claude Brain CLI
================

Commands:
  overview [--compact]          Get project overview
  search <query> [--type=...]   Search entries
  list [--type=...]             List entries
  read <id>                     Read an entry (alias: get)
  
  decide "Title" "Ctx" "Dec"    Record a decision
  log-bug "Title" "Sym" "Fix"   Record a bug fix
  implement "Title" "Desc"      Record implementation
  
  check "Change desc..."        Check for conflicts
  link <from> <to> <rel>        Link two entries
  health                        Get health check JSON

  update                        Update brain (hooks, skills, agents)
  snapshot [list|create|restore] Manage snapshots
  metrics                       Show usage metrics
  rebuild                       Rebuild index from files
  visualize                     Open interactive knowledge graph (alias: viz, graph)

Examples:
  node cli.js search "authentication"
  node cli.js visualize
  node cli.js update
  node cli.js snapshot create "before-refactoring"
  `);
}

main();
