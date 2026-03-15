#!/usr/bin/env node

/**
 * Brain Install Script — "Lisää aivot tähän projektiin"
 *
 * Usage:
 *   node install.js <brain-home> [extra-path:label] [extra-path:label] ...
 *   node install.js <brain-home> --update     ← Upgrade to latest version
 *
 * Examples:
 *   # Fresh install:
 *   node install.js C:\MyProject
 *
 *   # Fresh install with empty directory:
 *   node install.js .
 *
 *   # Multi-path (brain in first, others linked):
 *   node install.js C:\MinecraftServer "C:\MinecraftBot\bedrock:Bedrock-botit"
 *
 *   # Upgrade existing brain to latest:
 *   node install.js C:\MyProject --update
 *
 * The first argument is the "brain home" where .brain/ and CLAUDE.md are created.
 * Additional arguments are "path:label" pairs for other directories in the same project.
 * MCP server is registered in each directory's .mcp.json.
 */

import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BrainManager } from './lib/brain-manager.js';
import { analyzeProject, analyzeMultiplePaths, generateOverview } from './lib/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const BRAIN_VERSION = JSON.parse(
  await readFile(join(__dirname, 'package.json'), 'utf-8')
).version;

// ── Argument parsing ──

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
🧠 Brain v${BRAIN_VERSION} — Autonominen kontekstinhallinta

Käyttö:
  node install.js <brain-home> [polku:kuvaus] ...
  node install.js <brain-home> --update

Esimerkit:
  node install.js .                          ← Asenna nykyiseen kansioon
  node install.js C:\\MyProject               ← Asenna tiettyyn polkuun
  node install.js C:\\MyProject --update      ← Päivitä uusimpaan
  node install.js C:\\Server "C:\\Bot:Botit"   ← Moniprojekti

Ensimmäinen argumentti = .brain/-kansion sijainti.
Lisäpolut = saman projektin muut kansiot (polku:kuvaus).
--update = Päivitä olemassa olevat agentit, skills ja hooks.
`);
    process.exit(0);
  }

  const flags = {
    update: args.includes('--update') || args.includes('--force'),
  };

  const positionalArgs = args.filter(a => !a.startsWith('--'));

  if (positionalArgs.length === 0) {
    console.error('❌ Anna kohdepolku ensimmäisenä argumenttina.');
    process.exit(1);
  }

  const homePath = resolve(positionalArgs[0]);
  const extraPaths = [];

  for (let i = 1; i < positionalArgs.length; i++) {
    const colonIdx = positionalArgs[i].lastIndexOf(':');
    if (colonIdx > 2) { // avoid splitting C: drive letter
      extraPaths.push({
        path: resolve(positionalArgs[i].substring(0, colonIdx)),
        label: positionalArgs[i].substring(colonIdx + 1)
      });
    } else {
      extraPaths.push({
        path: resolve(positionalArgs[i]),
        label: resolve(positionalArgs[i]).split(/[/\\]/).filter(Boolean).pop()
      });
    }
  }

  return { homePath, extraPaths, flags };
}

// ── Main ──

async function main() {
  const { homePath, extraPaths, flags } = parseArgs();

  // Create home directory if it doesn't exist (Scenario 1: brand new empty dir)
  if (!existsSync(homePath)) {
    await mkdir(homePath, { recursive: true });
    console.log(`📂 Kansio luotu: ${homePath}`);
  }

  // Build full paths list (home first)
  const homeLabel = homePath.split(/[/\\]/).filter(Boolean).pop();
  const allPaths = [
    { path: homePath, label: homeLabel },
    ...extraPaths
  ];

  // Validate all paths exist
  for (const { path: p, label } of allPaths) {
    if (!existsSync(p)) {
      console.error(`❌ Kansiota ei löydy: ${p} (${label})`);
      process.exit(1);
    }
  }

  const isMultiPath = allPaths.length > 1;
  console.log(`\n🧠 Brain v${BRAIN_VERSION} — ${homePath}`);
  if (isMultiPath) {
    console.log(`   + ${extraPaths.length} lisäsijainti(a):`);
    for (const { path: p, label } of extraPaths) {
      console.log(`     - ${p} (${label})`);
    }
  }
  console.log();

  // ── Check if .brain/ already exists → update or skip ──
  const brainPath = join(homePath, '.brain');
  if (existsSync(brainPath)) {
    return await handleExistingBrain(homePath, brainPath, allPaths, flags);
  }

  // ── Fresh install ──
  await handleFreshInstall(homePath, brainPath, allPaths, isMultiPath, homeLabel);
}

// ── Scenario 3: Existing brain (update/upgrade) ──

async function handleExistingBrain(homePath, brainPath, allPaths, flags) {
  const homeLabel = homePath.split(/[/\\]/).filter(Boolean).pop();
  const isUpdate = flags.update;

  if (isUpdate) {
    console.log('🔄 Päivitetään Brain uusimpaan versioon...\n');
  } else {
    console.log('⚠ .brain/ on jo olemassa.');
    console.log('  Käytä --update päivittääksesi agentit, skills ja hooks.\n');
  }

  // Read current manifest to show version info
  const manager = new BrainManager(homePath);
  const manifest = await manager.loadManifest();
  const currentVersion = manifest.brainToolVersion || '(tuntematon)';

  if (isUpdate && currentVersion !== BRAIN_VERSION) {
    console.log(`   Versio: ${currentVersion} → ${BRAIN_VERSION}`);
  } else if (isUpdate) {
    console.log(`   Versio: ${currentVersion} (jo uusin)`);
  }

  // Update manifest paths and version
  manifest.paths = allPaths;
  manifest.projectName = homeLabel;
  manifest.brainToolVersion = BRAIN_VERSION;
  manifest.lastUpdated = new Date().toISOString().substring(0, 10);
  await writeFile(join(brainPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('   ✓ manifest.json päivitetty');

  // Always update CLAUDE.md and MCP registrations
  await updateClaudeMd(homePath);
  for (const { path: p } of allPaths) {
    await registerMcpServer(p, homePath);
  }

  // Deploy agents (force-update if --update)
  const deployedAgents = await deployAgents(homePath, isUpdate);
  if (deployedAgents.length > 0) {
    console.log(`   ✓ Agentit ${isUpdate ? 'päivitetty' : 'asennettu'}: ${deployedAgents.join(', ')}`);
  }

  // Deploy hooks (always idempotent, but update script paths)
  const deployedHooks = await deployHooks(homePath, isUpdate);
  if (deployedHooks > 0) {
    console.log(`   ✓ Hooks ${isUpdate ? 'päivitetty' : 'asennettu'} (${deployedHooks} tapahtumaa)`);
  }

  // Deploy skills (force-update if --update)
  const deployedSkills = await deploySkills(homePath, isUpdate);
  if (deployedSkills.length > 0) {
    console.log(`   ✓ Skills ${isUpdate ? 'päivitetty' : 'asennettu'}: ${deployedSkills.join(', ')}`);
  }

  // Ensure permissions are set
  await ensurePermissions(homePath);

  console.log(`\n✓ Brain v${BRAIN_VERSION} — CLAUDE.md, MCP, hooks ja skills päivitetty.\n`);

  // Log the update to changelog
  if (isUpdate) {
    try {
      await manager.appendChangelog(`Brain päivitetty versioon ${BRAIN_VERSION}`);
    } catch { /* changelog might not exist in very old installs */ }
  }
}

// ── Scenario 1 & 2: Fresh install ──

async function handleFreshInstall(homePath, brainPath, allPaths, isMultiPath, homeLabel) {
  // Analyze codebase(s)
  console.log('📊 Analysoidaan koodipohjaa...');
  let analysis;
  let projectName;

  if (isMultiPath) {
    analysis = await analyzeMultiplePaths(allPaths);
    projectName = homeLabel;
    analysis.name = projectName;
    for (const { label, analysis: a } of analysis.pathAnalyses) {
      console.log(`   📂 ${label}: ${a.types.join(', ') || 'tuntematon'}`);
    }
  } else {
    analysis = await analyzeProject(homePath);
    projectName = analysis.name;
    if (analysis.types.length > 0) {
      console.log(`   Tyyppi: ${analysis.types.join(', ')}`);
    } else {
      console.log('   📂 Tyhjä tai tunnistamaton projekti — aivot toimivat silti!');
    }
  }

  if (analysis.frameworks.length > 0) {
    console.log(`   Frameworkit: ${analysis.frameworks.join(', ')}`);
  }
  if (analysis.technologies.length > 0) {
    console.log(`   Teknologiat: ${analysis.technologies.join(', ')}`);
  }

  // Create .brain/ folder and initialize
  console.log('\n📁 Luodaan .brain/ -kansiorakenne...');
  const manager = new BrainManager(homePath);
  const overview = generateOverview(analysis);
  await manager.initBrain({
    projectName,
    overview,
    paths: allPaths
  });

  // Update brainToolVersion in manifest
  const manifest = await manager.loadManifest();
  manifest.brainToolVersion = BRAIN_VERSION;
  await writeFile(join(brainPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log('   ✓ manifest.json (v' + BRAIN_VERSION + ', paths: ' + allPaths.length + ')');
  console.log('   ✓ index.json');
  console.log('   ✓ overview.md');
  console.log('   ✓ history/changelog.md');
  console.log('   ✓ decisions/ implementations/ bugs/ patterns/ plans/');

  // Generate/update CLAUDE.md (only in brain home)
  console.log('\n📝 Päivitetään CLAUDE.md...');
  await updateClaudeMd(homePath);

  // Register MCP server in ALL paths
  console.log('\n🔌 Rekisteröidään MCP-serveri...');
  for (const { path: p, label } of allPaths) {
    await registerMcpServer(p, homePath);
    if (p !== homePath) {
      console.log(`     (${label})`);
    }
  }

  // Deploy bundled agents
  console.log('\n🤖 Asennetaan agentit...');
  const deployedAgents = await deployAgents(homePath);
  if (deployedAgents.length > 0) {
    for (const agent of deployedAgents) {
      console.log(`   ✓ ${agent}`);
    }
  } else {
    console.log('   (ei agentteja asennettavissa)');
  }

  // Deploy hooks
  console.log('\n🪝 Asennetaan hooks...');
  const deployedHooks = await deployHooks(homePath);
  if (deployedHooks > 0) {
    console.log(`   ✓ ${deployedHooks} hook-tapahtumaa rekisteröity`);
  }

  // Deploy skills
  console.log('\n🧩 Asennetaan skills...');
  const deployedSkills = await deploySkills(homePath);
  if (deployedSkills.length > 0) {
    for (const skill of deployedSkills) {
      console.log(`   ✓ ${skill}`);
    }
  }

  // Ensure permissions are configured
  await ensurePermissions(homePath);

  // Add .brain/ to .gitignore if git project
  if (existsSync(join(homePath, '.git'))) {
    await updateGitignore(homePath);
  }

  // Summary
  console.log('\n' + '═'.repeat(55));
  console.log(`✓ Brain v${BRAIN_VERSION} asennettu: ${brainPath}`);
  if (isMultiPath) {
    console.log(`  - ${allPaths.length} projektisijaintia yhdistetty`);
    for (const { path: p, label } of allPaths) {
      const marker = p === homePath ? ' (.brain/ täällä)' : '';
      console.log(`    • ${label}: ${p}${marker}`);
    }
  }
  console.log(`  - MCP-serveri rekisteröity ${allPaths.length} sijaintiin`);
  console.log(`  - CLAUDE.md päivitetty`);
  console.log(`  - Hooks: SessionStart, Clear, Stop, PreCompact`);
  console.log(`  - Skills: brain-workflow`);
  console.log('═'.repeat(55));
  console.log('\n→ Käynnistä Claude Code ja sano: "Tutustu aivoihin"');
  console.log('→ Tai käytä komentoriviltä: "npm run brain" tai "node cli.js"\n');
}

// ── CLAUDE.md management ──

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

    // Inject BRAIN_RECENT markers if missing
    let content = await readFile(claudeMdPath, 'utf-8');
    if (!content.includes('<!-- BRAIN_RECENT_START -->')) {
      content += '\n\n## Viimeisimmät brain-merkinnät (auto-päivittyy)\n\n<!-- BRAIN_RECENT_START -->\n_Ei merkintöjä vielä._\n<!-- BRAIN_RECENT_END -->\n';
      await writeFile(claudeMdPath, content, 'utf-8');
    }

    console.log('   ✓ CLAUDE.md päivitetty (olemassa oleva sisältö säilytetty)');
  } else {
    await writeFile(claudeMdPath, brainSection, 'utf-8');
    console.log('   ✓ CLAUDE.md luotu');
  }
}

// ── MCP server registration ──

async function registerMcpServer(targetPath, brainHomePath) {
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
  console.log(`   ✓ MCP rekisteröity: ${mcpJsonPath}`);
}

// ── Permissions ──

async function ensurePermissions(homePath) {
  const settingsDir = join(homePath, '.claude');
  const settingsPath = join(settingsDir, 'settings.local.json');

  if (!existsSync(settingsDir)) {
    await mkdir(settingsDir, { recursive: true });
  }

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  // Ensure permissions section exists
  if (!settings.permissions) {
    settings.permissions = {};
  }
  if (!Array.isArray(settings.permissions.allow)) {
    settings.permissions.allow = [];
  }

  // Add brain MCP tool permissions
  const requiredPermissions = [
    'mcp__brain__*',        // All brain MCP tools
  ];

  let added = 0;
  for (const perm of requiredPermissions) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
      added++;
    }
  }

  if (added > 0) {
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`   ✓ Permissiot: ${requiredPermissions.join(', ')}`);
  }
}

// ── .gitignore ──

async function updateGitignore(projectPath) {
  const gitignorePath = join(projectPath, '.gitignore');
  let content = '';

  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, 'utf-8');
    if (content.includes('.brain/')) return;
  }

  content += '\n# Brain - autonomous context management\n.brain/\n';
  await writeFile(gitignorePath, content, 'utf-8');
  console.log('   ✓ .brain/ lisätty .gitignore:en');
}

// ── Agent deployment ──

async function deployAgents(homePath, forceUpdate = false) {
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
    if (!existsSync(target) || forceUpdate) {
      const content = await readFile(join(agentsTemplateDir, file), 'utf-8');
      await writeFile(target, content, 'utf-8');
      deployed.push(file);
    }
  }
  return deployed;
}

// ── Hook deployment ──

async function deployHooks(homePath, forceUpdate = false) {
  const hooksTemplateDir = join(__dirname, 'templates', 'hooks');
  if (!existsSync(hooksTemplateDir)) return 0;

  const settingsDir = join(homePath, '.claude');
  const settingsPath = join(settingsDir, 'settings.local.json');

  if (!existsSync(settingsDir)) {
    await mkdir(settingsDir, { recursive: true });
  }

  // Load existing settings
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const sessionStartScript = join(hooksTemplateDir, 'brain-session-start.js');
  const sessionClearScript = join(hooksTemplateDir, 'brain-session-clear.js');
  const stopScript = join(hooksTemplateDir, 'brain-stop-check.js');
  const preCompactScript = join(hooksTemplateDir, 'brain-precompact.js');

  let hookCount = 0;

  // On force-update, clear all brain hooks and re-register fresh
  if (forceUpdate) {
    // Remove old brain hooks from all event types
    for (const eventType of ['SessionStart', 'Stop', 'PreCompact', 'PreToolUse', 'PostToolUse']) {
      if (Array.isArray(settings.hooks[eventType])) {
        settings.hooks[eventType] = settings.hooks[eventType].filter(
          g => !g.hooks?.some(h => h.command?.includes('brain-'))
        );
      }
    }
  }

  // SessionStart hook — inject brain context reminder
  if (!settings.hooks.SessionStart) {
    settings.hooks.SessionStart = [];
  }
  if (!settings.hooks.SessionStart.some(g => g.hooks?.some(h => h.command?.includes('brain-session-start')))) {
    settings.hooks.SessionStart.push({
      matcher: 'startup',
      hooks: [{
        type: 'command',
        command: `node "${sessionStartScript}"`,
        timeout: 5000
      }]
    });
    hookCount++;
  }

  // SessionStart (clear) hook
  if (!settings.hooks.SessionStart.some(g => g.hooks?.some(h => h.command?.includes('brain-session-clear')))) {
    settings.hooks.SessionStart.push({
      matcher: 'clear',
      hooks: [{
        type: 'command',
        command: `node "${sessionClearScript}"`,
        timeout: 5000
      }]
    });
    hookCount++;
  }

  // Stop hook — remind to save brain entries
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }
  if (!settings.hooks.Stop.some(g => g.hooks?.some(h => h.command?.includes('brain-stop-check')))) {
    settings.hooks.Stop.push({
      hooks: [{
        type: 'command',
        command: `node "${stopScript}"`,
        timeout: 5000,
        once: true
      }]
    });
    hookCount++;
  }

  // PreCompact hook — preserve brain context during compaction
  if (!settings.hooks.PreCompact) {
    settings.hooks.PreCompact = [];
  }
  if (!settings.hooks.PreCompact.some(g => g.hooks?.some(h => h.command?.includes('brain-precompact')))) {
    settings.hooks.PreCompact.push({
      hooks: [{
        type: 'command',
        command: `node "${preCompactScript}"`,
        timeout: 5000
      }]
    });
    hookCount++;
  }

  // ── New v2 hooks ──

  const preToolScript = join(hooksTemplateDir, 'brain-pre-tool.js');
  const postToolScript = join(hooksTemplateDir, 'brain-post-tool.js');
  const activityScript = join(hooksTemplateDir, 'brain-activity-check.js');

  // PreToolUse — conflict check reminder before file edits
  if (existsSync(preToolScript)) {
    if (!settings.hooks.PreToolUse) {
      settings.hooks.PreToolUse = [];
    }
    if (!settings.hooks.PreToolUse.some(g => g.hooks?.some(h => h.command?.includes('brain-pre-tool')))) {
      settings.hooks.PreToolUse.push({
        hooks: [{
          type: 'command',
          command: `node "${preToolScript}"`,
          timeout: 3000
        }]
      });
      hookCount++;
    }
  }

  // PostToolUse — documentation reminder after file edits
  if (existsSync(postToolScript)) {
    if (!settings.hooks.PostToolUse) {
      settings.hooks.PostToolUse = [];
    }
    if (!settings.hooks.PostToolUse.some(g => g.hooks?.some(h => h.command?.includes('brain-post-tool')))) {
      settings.hooks.PostToolUse.push({
        hooks: [{
          type: 'command',
          command: `node "${postToolScript}"`,
          timeout: 3000
        }]
      });
      hookCount++;
    }
  }

  // PostToolUse — activity check (reminds after 10 non-brain calls)
  if (existsSync(activityScript)) {
    if (!settings.hooks.PostToolUse) {
      settings.hooks.PostToolUse = [];
    }
    if (!settings.hooks.PostToolUse.some(g => g.hooks?.some(h => h.command?.includes('brain-activity-check')))) {
      settings.hooks.PostToolUse.push({
        hooks: [{
          type: 'command',
          command: `node "${activityScript}"`,
          timeout: 3000
        }]
      });
      hookCount++;
    }
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return hookCount;
}

// ── Skill deployment ──

async function deploySkills(homePath, forceUpdate = false) {
  const skillsTemplateDir = join(__dirname, 'templates', 'skills');
  if (!existsSync(skillsTemplateDir)) return [];

  const targetDir = join(homePath, '.claude', 'skills');
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  const deployed = [];
  const skillDirs = (await readdir(skillsTemplateDir, { withFileTypes: true }))
    .filter(d => d.isDirectory());

  for (const skillDir of skillDirs) {
    const srcDir = join(skillsTemplateDir, skillDir.name);
    const dstDir = join(targetDir, skillDir.name);

    if (!existsSync(dstDir)) {
      await mkdir(dstDir, { recursive: true });
    }

    // Copy all files in the skill directory
    const files = await readdir(srcDir);
    let changed = false;
    for (const file of files) {
      const dstFile = join(dstDir, file);
      if (!existsSync(dstFile) || forceUpdate) {
        const content = await readFile(join(srcDir, file), 'utf-8');
        await writeFile(dstFile, content, 'utf-8');
        changed = true;
      }
    }

    if (changed) {
      deployed.push(skillDir.name);
    }
  }

  return deployed;
}

main().catch(err => {
  console.error(`❌ Virhe: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
