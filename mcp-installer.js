#!/usr/bin/env node

/**
 * Brain MCP Installer — Global MCP server for installing Brain into any project
 *
 * Registered globally in ~/.claude.json and ~/.gemini/settings.json
 * so it's available in every project for both Claude Code and Gemini CLI.
 * Provides a single tool: brain_install
 *
 * After brain_install runs, the per-project mcp-server.js is registered
 * for both Claude and Gemini, and an AI restart activates all 19 brain_* tools.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BrainManager } from './lib/brain-manager.js';
import { analyzeProject, analyzeMultiplePaths, generateOverview } from './lib/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── MCP Protocol helpers (same as mcp-server.js) ──

const messageQueue = [];
let messageBuffer = '';
let messageWaiter = null;

function initStdin() {
  process.stdin.on('data', (chunk) => {
    messageBuffer += chunk.toString();

    while (true) {
      const newlineIdx = messageBuffer.indexOf('\n');
      if (newlineIdx === -1) break;

      const line = messageBuffer.substring(0, newlineIdx).trim();
      messageBuffer = messageBuffer.substring(newlineIdx + 1);

      if (line.length > 0) {
        try {
          const msg = JSON.parse(line);
          if (messageWaiter) {
            const resolve = messageWaiter;
            messageWaiter = null;
            resolve(msg);
          } else {
            messageQueue.push(msg);
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }
  });

  process.stdin.on('end', () => {
    if (messageWaiter) {
      const resolve = messageWaiter;
      messageWaiter = null;
      resolve(null);
    }
  });
}

function readMessage() {
  if (messageQueue.length > 0) {
    return Promise.resolve(messageQueue.shift());
  }
  return new Promise((resolve) => {
    messageWaiter = resolve;
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(json + '\n');
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── Tool definition ──

const TOOLS = [
  {
    name: 'brain_install',
    description:
      'Install Brain (autonomous context management) into a project. ' +
      'Creates .brain/ folder with project analysis, updates CLAUDE.md and GEMINI.md, registers per-project MCP server for both Claude and Gemini. ' +
      'After installation, the AI tool must be restarted to activate the 19 brain_* tools.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute path to the project root directory where .brain/ will be created'
        },
        extra_paths: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute path to additional directory' },
              label: { type: 'string', description: 'Short label for this directory' }
            },
            required: ['path', 'label']
          },
          description: 'Optional additional directories belonging to the same project'
        }
      },
      required: ['project_path']
    }
  }
];

// ── Installation logic (adapted from install.js) ──

async function handleBrainInstall(args) {
  const homePath = args.project_path;
  const extraPaths = args.extra_paths || [];

  // Validate home path exists
  if (!existsSync(homePath)) {
    return `Error: Directory not found: ${homePath}`;
  }

  // Build full paths list (home first)
  const homeLabel = homePath.split(/[/\\]/).filter(Boolean).pop();
  const allPaths = [
    { path: homePath, label: homeLabel },
    ...extraPaths
  ];

  // Validate all extra paths exist
  for (const { path: p, label } of extraPaths) {
    if (!existsSync(p)) {
      return `Error: Directory not found: ${p} (${label})`;
    }
  }

  const isMultiPath = allPaths.length > 1;
  const brainPath = join(homePath, '.brain');
  const log = [];

  // Check if .brain/ already exists
  if (existsSync(brainPath)) {
    log.push('.brain/ already exists — skipping initialization.');

    // Update manifest.json paths (may have changed)
    const manager = new BrainManager(homePath);
    const manifest = await manager.loadManifest();
    manifest.paths = allPaths;
    manifest.projectName = homeLabel;
    await writeFile(join(brainPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    log.push('manifest.json updated (paths: ' + allPaths.length + ')');

    log.push('Updating CLAUDE.md, GEMINI.md and MCP registrations...');

    await updateClaudeMd(homePath);
    await updateGeminiMd(homePath);
    for (const { path: p } of allPaths) {
      await registerMcpServer(p, homePath);
      await registerGeminiMcpServer(p, homePath);
    }

    log.push('CLAUDE.md, GEMINI.md and MCP registrations updated.');

    // Deploy bundled agents
    const deployedAgents = await deployAgents(homePath);
    if (deployedAgents.length > 0) {
      log.push(`Agents deployed: ${deployedAgents.join(', ')}`);
    }

    log.push('');
    log.push('Restart your AI tool (Claude Code / Gemini CLI) to activate brain_* tools.');
    return log.join('\n');
  }

  // Analyze codebase(s)
  log.push('Analyzing codebase...');

  let analysis;
  let projectName;

  if (isMultiPath) {
    analysis = await analyzeMultiplePaths(allPaths);
    projectName = homeLabel;
    analysis.name = projectName;
    for (const { label, analysis: a } of analysis.pathAnalyses) {
      log.push(`  ${label}: ${a.types.join(', ') || 'unknown'}`);
    }
  } else {
    analysis = await analyzeProject(homePath);
    projectName = analysis.name;
    log.push(`  Type: ${analysis.types.join(', ') || 'unknown'}`);
  }

  if (analysis.frameworks.length > 0) {
    log.push(`  Frameworks: ${analysis.frameworks.join(', ')}`);
  }
  if (analysis.technologies.length > 0) {
    log.push(`  Technologies: ${analysis.technologies.join(', ')}`);
  }

  // Create .brain/ folder and initialize
  log.push('');
  log.push('Creating .brain/ folder structure...');

  const manager = new BrainManager(homePath);
  const overview = generateOverview(analysis);
  await manager.initBrain({
    projectName,
    overview,
    paths: allPaths
  });

  log.push('  manifest.json (paths: ' + allPaths.length + ')');
  log.push('  index.json');
  log.push('  overview.md');
  log.push('  history/changelog.md');
  log.push('  decisions/ implementations/ bugs/ patterns/');

  // Generate/update CLAUDE.md and GEMINI.md
  log.push('');
  log.push('Updating CLAUDE.md and GEMINI.md...');
  await updateClaudeMd(homePath);
  await updateGeminiMd(homePath);

  // Register MCP server in ALL paths (for both Claude and Gemini)
  log.push('');
  log.push('Registering per-project MCP server (Claude + Gemini)...');
  for (const { path: p, label } of allPaths) {
    await registerMcpServer(p, homePath);
    await registerGeminiMcpServer(p, homePath);
    log.push(`  Registered: ${p}${p !== homePath ? ` (${label})` : ''}`);
  }

  // Deploy bundled agents
  const deployedAgents = await deployAgents(homePath);
  if (deployedAgents.length > 0) {
    log.push('');
    log.push('Deploying agents...');
    for (const agent of deployedAgents) {
      log.push(`  ${agent}`);
    }
  }

  // Add .brain/ to .gitignore if git project
  if (existsSync(join(homePath, '.git'))) {
    await updateGitignore(homePath);
    log.push('  .brain/ added to .gitignore');
  }

  // Summary
  log.push('');
  log.push('='.repeat(50));
  log.push(`Brain installed: ${brainPath}`);
  if (isMultiPath) {
    log.push(`  ${allPaths.length} project locations connected`);
    for (const { path: p, label } of allPaths) {
      const marker = p === homePath ? ' (.brain/ here)' : '';
      log.push(`  - ${label}: ${p}${marker}`);
    }
  }
  log.push(`  MCP server registered in ${allPaths.length} location(s) (Claude + Gemini)`);
  log.push(`  CLAUDE.md and GEMINI.md updated`);
  log.push('='.repeat(50));
  log.push('');
  log.push('Restart your AI tool (Claude Code / Gemini CLI) to activate the 19 brain_* tools.');

  return log.join('\n');
}

// ── Helper functions (from install.js) ──

async function updateClaudeMd(projectPath) {
  const claudeMdPath = join(projectPath, 'CLAUDE.md');
  const templatePath = join(__dirname, 'templates', 'CLAUDE.md.template');

  const brainSection = await readFile(templatePath, 'utf-8');

  if (existsSync(claudeMdPath)) {
    let existing = await readFile(claudeMdPath, 'utf-8');

    if (existing.includes('Autonominen Kontekstinhallinta') || existing.includes('brain_get_overview')) {
      const brainStart = existing.indexOf('# Projektin Aivot');
      if (brainStart !== -1) {
        const nextHeading = existing.indexOf('\n# ', brainStart + 1);
        if (nextHeading !== -1) {
          existing = brainSection + '\n\n' + existing.substring(nextHeading + 1);
        } else {
          existing = brainSection;
        }
      }
      await writeFile(claudeMdPath, existing, 'utf-8');
    } else {
      const combined = brainSection + '\n\n---\n\n' + existing;
      await writeFile(claudeMdPath, combined, 'utf-8');
    }
  } else {
    await writeFile(claudeMdPath, brainSection, 'utf-8');
  }
}

async function updateGeminiMd(projectPath) {
  const geminiMdPath = join(projectPath, 'GEMINI.md');
  const templatePath = join(__dirname, 'templates', 'GEMINI.md.template');

  const brainSection = await readFile(templatePath, 'utf-8');

  if (existsSync(geminiMdPath)) {
    let existing = await readFile(geminiMdPath, 'utf-8');

    if (existing.includes('Autonominen Kontekstinhallinta') || existing.includes('brain_get_overview')) {
      const brainStart = existing.indexOf('# Projektin Aivot');
      if (brainStart !== -1) {
        const nextHeading = existing.indexOf('\n# ', brainStart + 1);
        if (nextHeading !== -1) {
          existing = brainSection + '\n\n' + existing.substring(nextHeading + 1);
        } else {
          existing = brainSection;
        }
      }
      await writeFile(geminiMdPath, existing, 'utf-8');
    } else {
      const combined = brainSection + '\n\n---\n\n' + existing;
      await writeFile(geminiMdPath, combined, 'utf-8');
    }
  } else {
    await writeFile(geminiMdPath, brainSection, 'utf-8');
  }
}

async function registerGeminiMcpServer(targetPath, brainHomePath) {
  // Write to .gemini/settings.json in project root — Gemini CLI reads MCP servers from here
  const geminiDir = join(targetPath, '.gemini');
  const geminiSettingsPath = join(geminiDir, 'settings.json');
  const mcpServerPath = join(__dirname, 'mcp-server.js');

  // Ensure .gemini/ directory exists
  if (!existsSync(geminiDir)) {
    await mkdir(geminiDir, { recursive: true });
  }

  let geminiConfig = {};
  if (existsSync(geminiSettingsPath)) {
    try {
      const content = await readFile(geminiSettingsPath, 'utf-8');
      geminiConfig = JSON.parse(content);
    } catch {
      geminiConfig = {};
    }
  }

  if (!geminiConfig.mcpServers) {
    geminiConfig.mcpServers = {};
  }

  geminiConfig.mcpServers.brain = {
    command: 'node',
    args: [mcpServerPath],
    env: {
      BRAIN_PROJECT_PATH: brainHomePath
    },
    trust: true
  };

  await writeFile(geminiSettingsPath, JSON.stringify(geminiConfig, null, 2), 'utf-8');
}

async function registerMcpServer(targetPath, brainHomePath) {
  // Write to .mcp.json in project root — Claude Code reads MCP servers from here
  // (NOT from .claude/settings.local.json, which is only for permissions)
  const mcpJsonPath = join(targetPath, '.mcp.json');
  const mcpServerPath = join(__dirname, 'mcp-server.js');

  let mcpConfig = {};
  if (existsSync(mcpJsonPath)) {
    try {
      const content = await readFile(mcpJsonPath, 'utf-8');
      mcpConfig = JSON.parse(content);
    } catch {
      mcpConfig = {};
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  mcpConfig.mcpServers.brain = {
    command: 'node',
    args: [mcpServerPath],
    env: {
      BRAIN_PROJECT_PATH: brainHomePath
    }
  };

  await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
}

async function updateGitignore(projectPath) {
  const gitignorePath = join(projectPath, '.gitignore');
  let content = '';

  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, 'utf-8');
    if (content.includes('.brain/')) return;
  }

  content += '\n# Brain - autonomous context management\n.brain/\n';
  await writeFile(gitignorePath, content, 'utf-8');
}

async function deployAgents(homePath) {
  const agentsTemplateDir = join(__dirname, 'templates', 'agents');
  const targetDir = join(homePath, '.claude', 'agents');

  if (!existsSync(agentsTemplateDir)) return [];

  const files = (await readdir(agentsTemplateDir)).filter(f => f.endsWith('.md'));
  if (files.length === 0) return [];

  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  const deployed = [];
  for (const file of files) {
    const target = join(targetDir, file);
    if (!existsSync(target)) {
      const content = await readFile(join(agentsTemplateDir, file), 'utf-8');
      await writeFile(target, content, 'utf-8');
      deployed.push(file);
    }
  }
  return deployed;
}

// ── Main MCP loop ──

async function main() {
  process.stderr.write('Brain Installer MCP server started\n');

  initStdin();

  while (true) {
    let msg;
    try {
      msg = await readMessage();
    } catch {
      break;
    }

    if (!msg) break; // stdin closed

    if (!msg.method) {
      if (msg.id) sendResult(msg.id, {});
      continue;
    }

    switch (msg.method) {
      case 'initialize':
        sendResult(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'brain-installer',
            version: '1.0.0'
          }
        });
        break;

      case 'notifications/initialized':
        // No response needed
        break;

      case 'tools/list':
        sendResult(msg.id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const toolName = msg.params?.name;
        const toolArgs = msg.params?.arguments || {};

        if (toolName !== 'brain_install') {
          sendResult(msg.id, {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true
          });
          break;
        }

        try {
          const resultText = await handleBrainInstall(toolArgs);
          sendResult(msg.id, {
            content: [{ type: 'text', text: resultText }]
          });
        } catch (error) {
          sendResult(msg.id, {
            content: [{ type: 'text', text: `Installation error: ${error.message}\n${error.stack}` }],
            isError: true
          });
        }
        break;
      }

      default:
        if (msg.id) {
          sendError(msg.id, -32601, `Method not found: ${msg.method}`);
        }
    }
  }
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
