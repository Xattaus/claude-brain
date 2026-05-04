# Brain Integration Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate brain with Claude's native capabilities (superpowers specs/plans, environment scanning, research tracking, auto-overview) so brain becomes the single source of truth for all project knowledge.

**Architecture:** A sync engine orchestrates multiple integration modules. Superpowers-sync scans `docs/superpowers/` and creates brain entries. Environment-scanner discovers MCP servers/skills/agents. Session-integrator records research processes. Auto-overview generates `overview.md` from brain content.

**Tech Stack:** Node.js (ESM), node:test, node:fs/promises, node:crypto (for hashing), existing BrainManager/schemas infrastructure.

---

### Task 1: Superpowers Sync Module

**Files:**
- Create: `lib/integrations/superpowers-sync.js`
- Test: `tests/superpowers-sync.test.js`

- [ ] **Step 1: Write failing test — parse spec markdown**

```javascript
// tests/superpowers-sync.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SuperpowersSync } from '../lib/integrations/superpowers-sync.js';

describe('SuperpowersSync — parseSpecFile', () => {
  it('extracts title, date, and summary from a spec markdown file', () => {
    const content = `# Kauppa Stripe Paitavalitsin Design

## Summary
Stripe-integraatio kauppaan ja paitavalitsimen UI.

## Architecture
- Frontend: React + shadcn
- Backend: API routes

## Components
- PaymentForm
- JerseySelector
`;

    const result = SuperpowersSync.parseSpecFile(content, '2026-04-15-kauppa-stripe-paitavalitsin-design.md');

    assert.equal(result.title, 'Kauppa Stripe Paitavalitsin Design');
    assert.equal(result.date, '2026-04-15');
    assert.ok(result.summary.length <= 500);
    assert.ok(result.summary.includes('Stripe'));
    assert.deepEqual(result.tags, ['source:superpowers-spec']);
  });

  it('extracts title from filename when no heading found', () => {
    const content = 'Some content without a heading\n\nMore content here.';
    const result = SuperpowersSync.parseSpecFile(content, '2026-04-20-my-feature-design.md');

    assert.equal(result.title, 'my-feature-design');
    assert.equal(result.date, '2026-04-20');
  });

  it('extracts file paths from content', () => {
    const content = `# Test Design

## Files
- \`src/components/Foo.tsx\`
- \`src/api/bar.rs\`

## Other section
Content here.
`;
    const result = SuperpowersSync.parseSpecFile(content, '2026-05-01-test-design.md');
    assert.deepEqual(result.files, ['src/components/Foo.tsx', 'src/api/bar.rs']);
  });
});

describe('SuperpowersSync — parsePlanFile', () => {
  it('extracts title, date, status from a plan markdown file', () => {
    const content = `# Kauppa Stripe Paitavalitsin

> **For agentic workers:** Use superpowers skill...

**Goal:** Build Stripe integration

---

### Task 1: Setup

- [x] **Step 1: Install deps**
- [x] **Step 2: Configure**

### Task 2: Frontend

- [ ] **Step 1: Build form**
- [ ] **Step 2: Test**
`;

    const result = SuperpowersSync.parsePlanFile(content, '2026-04-15-kauppa-stripe-paitavalitsin.md');

    assert.equal(result.title, 'Kauppa Stripe Paitavalitsin');
    assert.equal(result.date, '2026-04-15');
    assert.equal(result.status, 'partial'); // some checked, some not
    assert.deepEqual(result.tags, ['source:superpowers-plan']);
  });

  it('detects completed plans (all checkboxes checked)', () => {
    const content = `# Done Plan

### Task 1: Only task
- [x] **Step 1: Done**
- [x] **Step 2: Done**
`;
    const result = SuperpowersSync.parsePlanFile(content, '2026-04-20-done-plan.md');
    assert.equal(result.status, 'completed');
  });

  it('detects planned status (no checkboxes checked)', () => {
    const content = `# New Plan

### Task 1: First task
- [ ] **Step 1: Todo**
- [ ] **Step 2: Todo**
`;
    const result = SuperpowersSync.parsePlanFile(content, '2026-04-20-new-plan.md');
    assert.equal(result.status, 'planned');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/superpowers-sync.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SuperpowersSync class**

```javascript
// lib/integrations/superpowers-sync.js
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

/**
 * SuperpowersSync — Syncs docs/superpowers/specs/ and plans/ to brain entries
 */
export class SuperpowersSync {
  constructor(manager) {
    this.manager = manager;
  }

  /**
   * Parse a spec markdown file and extract structured data
   */
  static parseSpecFile(content, filename) {
    const title = extractTitle(content, filename);
    const date = extractDate(filename);
    const summary = extractSummary(content);
    const files = extractFilePaths(content);

    return { title, date, summary, files, tags: ['source:superpowers-spec'] };
  }

  /**
   * Parse a plan markdown file and extract structured data
   */
  static parsePlanFile(content, filename) {
    const title = extractTitle(content, filename);
    const date = extractDate(filename);
    const summary = extractSummary(content);
    const files = extractFilePaths(content);
    const status = inferPlanStatus(content);

    return { title, date, summary, files, status, tags: ['source:superpowers-plan'] };
  }

  /**
   * Scan a directory for markdown files and return their metadata
   */
  async scanDirectory(dirPath) {
    if (!existsSync(dirPath)) return [];

    const files = await readdir(dirPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    const results = [];

    for (const file of mdFiles) {
      const fullPath = join(dirPath, file);
      const content = await readFile(fullPath, 'utf-8');
      const hash = createHash('md5').update(content).digest('hex');
      results.push({ file, fullPath, content, hash });
    }

    return results;
  }

  /**
   * Sync all superpowers docs to brain entries.
   * Returns { created, updated, unchanged } counts.
   */
  async sync(syncState) {
    const projectPath = this.manager.projectPath;
    const specsDir = join(projectPath, 'docs', 'superpowers', 'specs');
    const plansDir = join(projectPath, 'docs', 'superpowers', 'plans');

    const results = { created: 0, updated: 0, unchanged: 0 };

    // Sync specs
    const specFiles = await this.scanDirectory(specsDir);
    for (const { file, content, hash } of specFiles) {
      const existing = syncState.sources['superpowers-specs']?.files?.[file];
      if (existing && existing.hash === hash) {
        results.unchanged++;
        continue;
      }

      const parsed = SuperpowersSync.parseSpecFile(content, file);
      if (existing?.brainId) {
        await this.manager.updateEntry(existing.brainId, {
          content: parsed.summary,
          status: 'active'
        });
        results.updated++;
      } else {
        const entry = await this.manager.createEntry({
          type: 'plan',
          prefix: 'PLAN',
          dirName: 'plans',
          title: parsed.title,
          frontmatter: {
            status: 'active',
            priority: 'medium',
            tags: parsed.tags,
            files: parsed.files,
            related: [],
            source_file: `docs/superpowers/specs/${file}`
          },
          body: `## Source\n\nSuperpowers spec: \`docs/superpowers/specs/${file}\`\n\n## Summary\n\n${parsed.summary}\n`
        });
        syncState.sources['superpowers-specs'] = syncState.sources['superpowers-specs'] || { files: {} };
        syncState.sources['superpowers-specs'].files[file] = {
          hash,
          brainId: entry.id,
          syncedAt: new Date().toISOString()
        };
        results.created++;
      }
    }

    // Sync plans
    const planFiles = await this.scanDirectory(plansDir);
    for (const { file, content, hash } of planFiles) {
      const existing = syncState.sources['superpowers-plans']?.files?.[file];
      if (existing && existing.hash === hash) {
        results.unchanged++;
        continue;
      }

      const parsed = SuperpowersSync.parsePlanFile(content, file);
      if (existing?.brainId) {
        await this.manager.updateEntry(existing.brainId, {
          content: parsed.summary,
          status: parsed.status
        });
        results.updated++;
      } else {
        const entry = await this.manager.createEntry({
          type: 'plan',
          prefix: 'PLAN',
          dirName: 'plans',
          title: parsed.title,
          frontmatter: {
            status: parsed.status,
            priority: 'medium',
            tags: parsed.tags,
            files: parsed.files,
            related: [],
            source_file: `docs/superpowers/plans/${file}`
          },
          body: `## Source\n\nSuperpowers plan: \`docs/superpowers/plans/${file}\`\n\n## Summary\n\n${parsed.summary}\n`
        });
        syncState.sources['superpowers-plans'] = syncState.sources['superpowers-plans'] || { files: {} };
        syncState.sources['superpowers-plans'].files[file] = {
          hash,
          brainId: entry.id,
          syncedAt: new Date().toISOString()
        };
        results.created++;
      }
    }

    return results;
  }
}

// ── Helper functions ──

function extractTitle(content, filename) {
  const headingMatch = content.match(/^# (.+)$/m);
  if (headingMatch) return headingMatch[1].trim();

  // Fallback: derive from filename
  const base = filename.replace(/\.md$/, '');
  const withoutDate = base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return withoutDate;
}

function extractDate(filename) {
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];
}

function extractSummary(content) {
  // Remove the title line
  const withoutTitle = content.replace(/^# .+\n+/, '');

  // Remove header boilerplate (> **For agentic workers:**... and **Goal:**... lines)
  const withoutBoilerplate = withoutTitle
    .replace(/^>.*\n+/gm, '')
    .replace(/^\*\*Goal:\*\*.*\n+/gm, '')
    .replace(/^\*\*Architecture:\*\*.*\n+/gm, '')
    .replace(/^\*\*Tech Stack:\*\*.*\n+/gm, '')
    .replace(/^---\n+/gm, '');

  // Take first meaningful paragraph or first 500 chars
  const paragraphs = withoutBoilerplate.split(/\n\n+/).filter(p => p.trim().length > 0);
  let summary = '';
  for (const p of paragraphs) {
    if (summary.length + p.length > 500) break;
    summary += (summary ? '\n\n' : '') + p.trim();
  }

  return summary || withoutBoilerplate.substring(0, 500).trim();
}

function extractFilePaths(content) {
  const paths = [];
  // Match backtick-wrapped paths that look like file paths
  const pathRegex = /`([a-zA-Z][\w\-./]*\.[a-zA-Z]{1,10})`/g;
  let match;
  while ((match = pathRegex.exec(content)) !== null) {
    const p = match[1];
    // Filter out obvious non-paths
    if (p.includes('/') && !p.startsWith('http')) {
      paths.push(p);
    }
  }
  return [...new Set(paths)];
}

function inferPlanStatus(content) {
  const checkedCount = (content.match(/- \[x\]/gi) || []).length;
  const uncheckedCount = (content.match(/- \[ \]/g) || []).length;
  const total = checkedCount + uncheckedCount;

  if (total === 0) return 'planned';
  if (uncheckedCount === 0) return 'completed';
  if (checkedCount === 0) return 'planned';
  return 'partial';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/superpowers-sync.test.js`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/superpowers-sync.js tests/superpowers-sync.test.js
git commit -m "feat: add SuperpowersSync module with parse/scan/sync logic"
```

---

### Task 2: Sync Engine

**Files:**
- Create: `lib/integrations/sync-engine.js`
- Test: `tests/sync-engine.test.js`

- [ ] **Step 1: Write failing test — sync state management**

```javascript
// tests/sync-engine.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SyncEngine } from '../lib/integrations/sync-engine.js';
import { BrainManager } from '../lib/brain-manager.js';

describe('SyncEngine — state management', () => {
  let tempDir, manager, engine;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sync-test-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'sync-test',
      overview: '# Sync Test',
      paths: [{ path: tempDir, label: 'root' }]
    });
    engine = new SyncEngine(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('creates fresh sync state on first load', async () => {
    const state = await engine.loadSyncState();
    assert.equal(state.version, 1);
    assert.ok(state.sources);
  });

  it('saves and reloads sync state', async () => {
    const state = await engine.loadSyncState();
    state.sources['test'] = { files: { 'a.md': { hash: 'abc', brainId: 'PLAN-001' } } };
    await engine.saveSyncState(state);

    const reloaded = await engine.loadSyncState();
    assert.equal(reloaded.sources['test'].files['a.md'].hash, 'abc');
  });
});

describe('SyncEngine — full sync cycle', () => {
  let tempDir, manager, engine;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sync-full-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'sync-full-test',
      overview: '# Full Sync Test',
      paths: [{ path: tempDir, label: 'root' }]
    });
    engine = new SyncEngine(manager);

    // Create superpowers docs
    await mkdir(join(tempDir, 'docs', 'superpowers', 'specs'), { recursive: true });
    await mkdir(join(tempDir, 'docs', 'superpowers', 'plans'), { recursive: true });

    await writeFile(join(tempDir, 'docs', 'superpowers', 'specs', '2026-05-01-test-design.md'),
      '# Test Feature Design\n\n## Summary\nA test feature.\n\n## Architecture\nSimple module.\n');

    await writeFile(join(tempDir, 'docs', 'superpowers', 'plans', '2026-05-01-test-feature.md'),
      '# Test Feature\n\n### Task 1: Setup\n- [x] **Step 1: Done**\n\n### Task 2: Build\n- [ ] **Step 1: Todo**\n');
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('syncs spec and plan files to brain entries', async () => {
    const results = await engine.runSync();

    assert.equal(results.created, 2);
    assert.equal(results.updated, 0);
    assert.equal(results.unchanged, 0);

    // Verify entries exist in brain
    const index = await manager.loadIndex();
    const plans = index.entries.filter(e => e.type === 'plan');
    assert.equal(plans.length, 2);
    assert.ok(plans.some(p => p.title === 'Test Feature Design'));
    assert.ok(plans.some(p => p.title === 'Test Feature'));
  });

  it('does not duplicate on second sync', async () => {
    const results = await engine.runSync();
    assert.equal(results.created, 0);
    assert.equal(results.unchanged, 2);
  });

  it('detects changed files and updates', async () => {
    await writeFile(join(tempDir, 'docs', 'superpowers', 'specs', '2026-05-01-test-design.md'),
      '# Test Feature Design v2\n\n## Summary\nUpdated test feature.\n');

    const results = await engine.runSync();
    assert.equal(results.updated, 1);
    assert.equal(results.unchanged, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sync-engine.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SyncEngine**

```javascript
// lib/integrations/sync-engine.js
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { SuperpowersSync } from './superpowers-sync.js';

/**
 * SyncEngine — Orchestrates all sync sources for brain
 */
export class SyncEngine {
  constructor(manager) {
    this.manager = manager;
    this.statePath = join(manager.brainPath, 'sync-state.json');
    this.superpowersSync = new SuperpowersSync(manager);
  }

  async loadSyncState() {
    if (!existsSync(this.statePath)) {
      return { version: 1, lastSync: null, sources: {} };
    }
    try {
      const data = await readFile(this.statePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return { version: 1, lastSync: null, sources: {} };
    }
  }

  async saveSyncState(state) {
    state.lastSync = new Date().toISOString();
    await writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Run a full sync cycle across all sources.
   * Returns aggregate { created, updated, unchanged }
   */
  async runSync() {
    const state = await this.loadSyncState();
    const results = await this.superpowersSync.sync(state);
    await this.saveSyncState(state);
    return results;
  }

  /**
   * Check if sync is needed (new/changed files since last sync)
   */
  async needsSync() {
    const state = await this.loadSyncState();
    if (!state.lastSync) return true;

    const specsDir = join(this.manager.projectPath, 'docs', 'superpowers', 'specs');
    const plansDir = join(this.manager.projectPath, 'docs', 'superpowers', 'plans');

    const specFiles = await this.superpowersSync.scanDirectory(specsDir);
    const planFiles = await this.superpowersSync.scanDirectory(plansDir);

    const allFiles = [...specFiles, ...planFiles];
    for (const { file, hash } of allFiles) {
      const specState = state.sources['superpowers-specs']?.files?.[file];
      const planState = state.sources['superpowers-plans']?.files?.[file];
      const existing = specState || planState;
      if (!existing || existing.hash !== hash) return true;
    }

    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sync-engine.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/sync-engine.js tests/sync-engine.test.js
git commit -m "feat: add SyncEngine orchestrator with state management"
```

---

### Task 3: Environment Scanner

**Files:**
- Create: `lib/integrations/environment-scanner.js`
- Test: `tests/environment-scanner.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/environment-scanner.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EnvironmentScanner } from '../lib/integrations/environment-scanner.js';

describe('EnvironmentScanner — MCP servers', () => {
  let tempDir, scanner;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'env-scan-'));
    // Create mock settings.json
    await mkdir(join(tempDir, '.claude'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: {
        brain: { command: 'node', args: ['mcp-server.js'] },
        playwright: { command: 'npx', args: ['@anthropic/mcp-playwright'] }
      }
    }));
    scanner = new EnvironmentScanner(tempDir);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('discovers MCP servers from settings.json', async () => {
    const env = await scanner.scanMcpServers(join(tempDir, '.claude', 'settings.json'));
    assert.equal(env.length, 2);
    assert.ok(env.some(s => s.name === 'brain'));
    assert.ok(env.some(s => s.name === 'playwright'));
  });
});

describe('EnvironmentScanner — custom agents', () => {
  let tempDir, scanner;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'env-agents-'));
    await mkdir(join(tempDir, '.claude', 'agents'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'agents', 'code-reviewer.md'),
      '---\ndescription: Reviews code for quality\n---\nYou are a code reviewer.');
    await writeFile(join(tempDir, '.claude', 'agents', 'architect.md'),
      '---\ndescription: Designs systems\n---\nYou are an architect.');
    scanner = new EnvironmentScanner(tempDir);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('discovers custom agent files', async () => {
    const agents = await scanner.scanCustomAgents();
    assert.equal(agents.length, 2);
    assert.ok(agents.some(a => a.name === 'code-reviewer'));
    assert.ok(agents.some(a => a.description === 'Designs systems'));
  });
});

describe('EnvironmentScanner — full scan', () => {
  let tempDir, scanner;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'env-full-'));
    await mkdir(join(tempDir, '.claude'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: { brain: { command: 'node', args: ['mcp-server.js'] } }
    }));
    scanner = new EnvironmentScanner(tempDir);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('produces complete environment report', async () => {
    const env = await scanner.scan();
    assert.equal(env.version, 1);
    assert.ok(env.scanned);
    assert.ok(Array.isArray(env.mcp_servers));
    assert.ok(Array.isArray(env.custom_agents));
    assert.ok(Array.isArray(env.skills));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/environment-scanner.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement EnvironmentScanner**

```javascript
// lib/integrations/environment-scanner.js
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * EnvironmentScanner — Discovers MCP servers, skills, agents, hooks
 */
export class EnvironmentScanner {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.homeDir = homedir();
  }

  /**
   * Scan MCP servers from a settings.json file
   */
  async scanMcpServers(settingsPath) {
    if (!existsSync(settingsPath)) return [];

    try {
      const data = JSON.parse(await readFile(settingsPath, 'utf-8'));
      const servers = data.mcpServers || {};
      return Object.entries(servers).map(([name, config]) => ({
        name,
        command: config.command || '',
        args: config.args || []
      }));
    } catch {
      return [];
    }
  }

  /**
   * Scan custom agent files from .claude/agents/
   */
  async scanCustomAgents() {
    const agentsDir = join(this.projectPath, '.claude', 'agents');
    if (!existsSync(agentsDir)) return [];

    try {
      const files = await readdir(agentsDir);
      const agents = [];
      for (const file of files.filter(f => f.endsWith('.md'))) {
        const content = await readFile(join(agentsDir, file), 'utf-8');
        const descMatch = content.match(/description:\s*(.+)/);
        agents.push({
          name: basename(file, '.md'),
          file: `.claude/agents/${file}`,
          description: descMatch ? descMatch[1].trim() : ''
        });
      }
      return agents;
    } catch {
      return [];
    }
  }

  /**
   * Scan superpowers skills from plugin cache
   */
  async scanSkills() {
    const pluginBase = join(this.homeDir, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers');
    if (!existsSync(pluginBase)) return [];

    try {
      const versions = await readdir(pluginBase);
      if (versions.length === 0) return [];

      // Use the latest version
      const latestVersion = versions.sort().pop();
      const skillsDir = join(pluginBase, latestVersion, 'skills');
      if (!existsSync(skillsDir)) return [];

      const skillDirs = await readdir(skillsDir);
      const skills = [];
      for (const dir of skillDirs) {
        const indexPath = join(skillsDir, dir, 'SKILL.md');
        let description = '';
        if (existsSync(indexPath)) {
          const content = await readFile(indexPath, 'utf-8');
          const descMatch = content.match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
        }
        skills.push({ name: dir, description });
      }
      return skills;
    } catch {
      return [];
    }
  }

  /**
   * Full environment scan — produces environment.json data
   */
  async scan() {
    // Try project-level settings first, then user-level
    const projectSettings = join(this.projectPath, '.claude', 'settings.json');
    const userSettings = join(this.homeDir, '.claude', 'settings.json');
    const settingsPath = existsSync(projectSettings) ? projectSettings : userSettings;

    const mcpServers = await this.scanMcpServers(settingsPath);
    const customAgents = await this.scanCustomAgents();
    const skills = await this.scanSkills();

    return {
      version: 1,
      scanned: new Date().toISOString(),
      mcp_servers: mcpServers,
      custom_agents: customAgents,
      skills
    };
  }

  /**
   * Scan and save to .brain/environment.json
   */
  async scanAndSave(brainPath) {
    const env = await this.scan();
    await writeFile(join(brainPath, 'environment.json'), JSON.stringify(env, null, 2), 'utf-8');
    return env;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/environment-scanner.test.js`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/environment-scanner.js tests/environment-scanner.test.js
git commit -m "feat: add EnvironmentScanner for MCP/skills/agents discovery"
```

---

### Task 4: Auto-Overview Generator

**Files:**
- Create: `lib/auto-overview.js`
- Test: `tests/auto-overview.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/auto-overview.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutoOverview } from '../lib/auto-overview.js';
import { BrainManager } from '../lib/brain-manager.js';

describe('AutoOverview — tech stack detection', () => {
  it('detects Rust from .rs files', () => {
    const files = ['src/main.rs', 'src/lib.rs', 'src/bot.rs'];
    const stack = AutoOverview.detectTechStack(files);
    assert.ok(stack.includes('Rust'));
  });

  it('detects TypeScript/React from .tsx files', () => {
    const files = ['src/App.tsx', 'src/components/Foo.tsx'];
    const stack = AutoOverview.detectTechStack(files);
    assert.ok(stack.includes('TypeScript/React'));
  });

  it('detects multiple technologies', () => {
    const files = ['src/main.rs', 'web/App.tsx', 'db/schema.sql'];
    const stack = AutoOverview.detectTechStack(files);
    assert.ok(stack.length >= 2);
  });
});

describe('AutoOverview — generation', () => {
  let tempDir, manager, overview;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'overview-test-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'TestProject',
      overview: '# TestProject\n\n> Projekti\n',
      paths: [{ path: tempDir, label: 'root' }]
    });

    // Create some entries to generate from
    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Use SQLite for storage',
      frontmatter: { status: 'active', tags: ['database'], files: ['src/database.rs'], related: [] },
      body: '## Context\nNeed a database.\n\n## Decision\nUse SQLite.\n'
    });
    await manager.createEntry({
      type: 'implementation', prefix: 'IMPL', dirName: 'implementations',
      title: 'User authentication system',
      frontmatter: { status: 'current', tags: ['auth'], files: ['src/auth.rs', 'web/Login.tsx'], related: [] },
      body: '## Description\nJWT-based auth.\n'
    });
    await manager.createEntry({
      type: 'lesson', prefix: 'LES', dirName: 'lessons',
      title: 'Always validate input',
      frontmatter: { status: 'active', severity: 'high', trigger: 'bug', tags: ['security'], files: [], related: [] },
      body: '## What happened\nSQL injection.\n\n## Lesson\nValidate everything.\n\n## Rule\nNever trust user input.\n'
    });

    overview = new AutoOverview(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('generates overview with project name', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('# TestProject'));
  });

  it('includes tech stack section', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('## Tech Stack'));
    assert.ok(text.includes('Rust'));
    assert.ok(text.includes('TypeScript/React'));
  });

  it('includes critical rules from lessons', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('Always validate input'));
  });

  it('includes auto-generated marker', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('Auto-generated'));
  });
});

describe('AutoOverview — staleness check', () => {
  let tempDir, manager, overview;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'stale-test-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'StaleTest',
      overview: '# StaleTest\n\n> Projekti\n',
      paths: [{ path: tempDir, label: 'root' }]
    });
    overview = new AutoOverview(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('considers empty overview as needing regeneration', async () => {
    const needs = await overview.needsRegeneration();
    assert.equal(needs, true);
  });

  it('respects manual override tag', async () => {
    await writeFile(join(tempDir, '.brain', 'overview.md'),
      '<!-- manual -->\n# My Custom Overview\n\nHand-written content.');
    const needs = await overview.needsRegeneration();
    assert.equal(needs, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/auto-overview.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AutoOverview**

```javascript
// lib/auto-overview.js
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TECH_MAP = {
  '.rs': 'Rust',
  '.tsx': 'TypeScript/React',
  '.ts': 'TypeScript',
  '.js': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.java': 'Java',
  '.sql': 'SQL/SQLite',
  '.vue': 'Vue.js',
  '.svelte': 'Svelte',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.html': 'HTML'
};

/**
 * AutoOverview — Generates overview.md from brain content
 */
export class AutoOverview {
  constructor(manager) {
    this.manager = manager;
  }

  /**
   * Detect tech stack from an array of file paths
   */
  static detectTechStack(files) {
    const detected = new Set();
    for (const file of files) {
      for (const [ext, tech] of Object.entries(TECH_MAP)) {
        if (file.endsWith(ext)) {
          detected.add(tech);
          break;
        }
      }
    }
    // If both TypeScript and TypeScript/React detected, keep only React
    if (detected.has('TypeScript/React') && detected.has('TypeScript')) {
      detected.delete('TypeScript');
    }
    return [...detected];
  }

  /**
   * Check if overview needs regeneration
   */
  async needsRegeneration() {
    const overviewPath = join(this.manager.brainPath, 'overview.md');
    try {
      const content = await readFile(overviewPath, 'utf-8');
      // Respect manual override
      if (content.includes('<!-- manual -->')) return false;
      // Empty or minimal overview
      if (content.trim().length < 100) return true;
      // Check if auto-generated and stale
      const dateMatch = content.match(/Auto-generated (\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) return true; // Not auto-generated, but short → regenerate
      const genDate = new Date(dateMatch[1]);
      const daysSince = (Date.now() - genDate.getTime()) / 86400000;
      if (daysSince < 7) return false;
      // Check if new entries since generation
      const index = await this.manager.loadIndex();
      const hasNewEntries = index.entries.some(e => new Date(e.date) > genDate);
      return hasNewEntries;
    } catch {
      return true; // No overview file → needs generation
    }
  }

  /**
   * Generate overview markdown from brain entries
   */
  async generate() {
    const manifest = await this.manager.loadManifest();
    const index = await this.manager.loadIndex();
    const projectName = manifest.projectName || 'Project';
    const entries = index.entries;

    // Collect all files for tech detection
    const allFiles = entries.flatMap(e => e.files || []);
    const techStack = AutoOverview.detectTechStack(allFiles);

    // Get active decisions for architecture
    const decisions = entries.filter(e => e.type === 'decision' && e.status === 'active');

    // Get recent implementations
    const implementations = entries
      .filter(e => e.type === 'implementation')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 5);

    // Get high-severity lessons
    const lessons = entries
      .filter(e => e.type === 'lesson' && e.severity === 'high')
      .slice(0, 5);

    // Get open/partial plans
    const plans = entries
      .filter(e => e.type === 'plan' && (e.status === 'partial' || e.status === 'in_progress' || e.status === 'planned'))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Build overview
    let text = `# ${projectName}\n\n`;
    text += `> ${entries.length} brain entries | ${decisions.length} active decisions | Auto-managed overview\n\n`;

    if (techStack.length > 0) {
      text += '## Tech Stack\n';
      for (const tech of techStack) {
        text += `- ${tech}\n`;
      }
      text += '\n';
    }

    if (decisions.length > 0) {
      text += '## Architecture (Key Decisions)\n';
      for (const d of decisions.slice(0, 10)) {
        text += `- **${d.id}**: ${d.title}\n`;
      }
      text += '\n';
    }

    if (implementations.length > 0) {
      text += '## Recent Development\n';
      for (const i of implementations) {
        text += `- **${i.id}** [${i.date}]: ${i.title}\n`;
      }
      text += '\n';
    }

    if (plans.length > 0) {
      text += '## Active Plans\n';
      for (const p of plans.slice(0, 5)) {
        text += `- **${p.id}** [${p.status}]: ${p.title}\n`;
      }
      text += '\n';
    }

    if (lessons.length > 0) {
      text += '## Critical Rules (from lessons)\n';
      for (const l of lessons) {
        text += `- **${l.id}**: ${l.title}\n`;
      }
      text += '\n';
    }

    const today = new Date().toISOString().split('T')[0];
    text += `---\n*Auto-generated ${today} from ${entries.length} brain entries. Add \`<!-- manual -->\` to override.*\n`;

    return text;
  }

  /**
   * Generate and save overview.md
   */
  async generateAndSave() {
    const shouldRegenerate = await this.needsRegeneration();
    if (!shouldRegenerate) return null;

    const text = await this.generate();
    await writeFile(join(this.manager.brainPath, 'overview.md'), text, 'utf-8');
    return text;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/auto-overview.test.js`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/auto-overview.js tests/auto-overview.test.js
git commit -m "feat: add AutoOverview generator from brain entries"
```

---

### Task 5: Session Integrator (brain_record_research)

**Files:**
- Create: `lib/integrations/session-integrator.js`
- Modify: `lib/schemas.js` — add RecordResearchSchema
- Modify: `lib/utils/body-builders.js` — add buildResearchBody
- Test: `tests/session-integrator.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/session-integrator.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionIntegrator } from '../lib/integrations/session-integrator.js';
import { BrainManager } from '../lib/brain-manager.js';

describe('SessionIntegrator — record research', () => {
  let tempDir, manager, integrator;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'session-int-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'session-test',
      overview: '# Session Test',
      paths: [{ path: tempDir, label: 'root' }]
    });
    integrator = new SessionIntegrator(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('creates a research entry with alternatives and rejections', async () => {
    const result = await integrator.recordResearch({
      title: 'ELO vs TrueSkill evaluation',
      alternatives: [
        { name: 'ELO', description: 'Simple, proven for 1v1' },
        { name: 'TrueSkill', description: 'Better for teams, complex' },
        { name: 'Glicko-2', description: 'Confidence intervals' }
      ],
      rejected: [
        { name: 'TrueSkill', reason: 'Too complex for this context' },
        { name: 'Glicko-2', reason: 'Requires regular play for reliability' }
      ],
      conclusion: 'ELO selected — simplicity wins for Classic AP context',
      agent_data: 'Researcher agent compared 3 papers',
      tags: ['matchmaking', 'research']
    });

    assert.ok(result.id.startsWith('RES-'));
    assert.ok(result.path.includes('research/'));

    // Verify in index
    const index = await manager.loadIndex();
    const entry = index.entries.find(e => e.id === result.id);
    assert.equal(entry.type, 'research');
    assert.equal(entry.title, 'ELO vs TrueSkill evaluation');
  });

  it('creates research entry with minimal data', async () => {
    const result = await integrator.recordResearch({
      title: 'Quick investigation',
      alternatives: [{ name: 'Option A', description: 'First option' }],
      conclusion: 'Option A works fine'
    });

    assert.ok(result.id.startsWith('RES-'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-integrator.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Add RES counter to BrainManager.initBrain**

In `lib/brain-manager.js`, find the `initBrain` method's counters initialization:

```javascript
// In the initBrain method, update the counters line:
counters: { DEC: 0, BUG: 0, IMPL: 0, PAT: 0, PLAN: 0, LES: 0, RES: 0 }
```

Also update `loadIndex` fallback counters to include RES:

```javascript
return { version: 1, project: '', entries: [], counters: { DEC: 0, BUG: 0, IMPL: 0, PAT: 0, PLAN: 0, LES: 0, RES: 0 } };
```

- [ ] **Step 4: Add research body builder**

Append to `lib/utils/body-builders.js`:

```javascript
export function buildResearchBody(args, t) {
  let body = '';

  if (args.alternatives && args.alternatives.length > 0) {
    body += '## Alternatives Explored\n\n';
    for (const alt of args.alternatives) {
      body += `### ${alt.name}\n${alt.description}\n\n`;
    }
  }

  if (args.rejected && args.rejected.length > 0) {
    body += '## Rejected (and why)\n\n';
    for (const rej of args.rejected) {
      body += `- **${rej.name}**: ${rej.reason}\n`;
    }
    body += '\n';
  }

  body += `## Conclusion\n\n${args.conclusion}\n\n`;

  if (args.agent_data) {
    body += `## Agent Data\n\n${args.agent_data}\n\n`;
  }

  return body;
}
```

- [ ] **Step 5: Add RecordResearchSchema to schemas.js**

Append before the TOOL_SCHEMAS map:

```javascript
export const RecordResearchSchema = z.object({
  title: Title,
  alternatives: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1)
  })).min(1, 'At least one alternative required'),
  rejected: z.array(z.object({
    name: z.string().min(1),
    reason: z.string().min(1)
  })).optional().default([]),
  conclusion: z.string().min(1, 'Conclusion is required'),
  agent_data: z.string().optional(),
  tags: Tags,
  files: Files,
  related: z.array(RelatedEntry).optional().default([])
});
```

Add to TOOL_SCHEMAS map:

```javascript
brain_record_research: RecordResearchSchema,
```

- [ ] **Step 6: Implement SessionIntegrator**

```javascript
// lib/integrations/session-integrator.js
import { buildResearchBody } from '../utils/body-builders.js';
import { getTranslator } from '../i18n.js';

/**
 * SessionIntegrator — Records research processes and agent data to brain
 */
export class SessionIntegrator {
  constructor(manager) {
    this.manager = manager;
    this.t = getTranslator('en');
  }

  /**
   * Record a research entry (alternatives explored, rejected options, conclusion)
   */
  async recordResearch(args) {
    const body = buildResearchBody(args, this.t);
    const result = await this.manager.createEntry({
      type: 'research',
      prefix: 'RES',
      dirName: 'research',
      title: args.title,
      frontmatter: {
        status: 'completed',
        tags: args.tags || [],
        files: args.files || [],
        related: args.related || []
      },
      body
    });

    // Link to related entries
    if (args.related) {
      for (const rel of args.related) {
        try {
          await this.manager.linkEntries(result.id, rel.id, rel.rel);
        } catch { /* skip */ }
      }
    }

    return result;
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/session-integrator.test.js`
Expected: All 2 tests PASS

- [ ] **Step 8: Commit**

```bash
git add lib/integrations/session-integrator.js lib/utils/body-builders.js lib/schemas.js lib/brain-manager.js tests/session-integrator.test.js
git commit -m "feat: add SessionIntegrator with brain_record_research support"
```

---

### Task 6: New MCP Tool Definitions and Handler Registration

**Files:**
- Modify: `mcp-server.js` — add 4 new tool definitions
- Create: `lib/handlers/integration.js` — handlers for new tools
- Modify: `lib/handlers/index.js` — register integration handlers
- Modify: `lib/handlers/core.js` — add auto-sync to brain_get_overview

- [ ] **Step 1: Create integration handler module**

```javascript
// lib/handlers/integration.js
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
```

- [ ] **Step 2: Register in handlers/index.js**

Replace content of `lib/handlers/index.js`:

```javascript
// Handler aggregator — merges all handler maps into a single dispatch table

import { coreHandlers } from './core.js';
import { recordingHandlers } from './recording.js';
import { contextHandlers } from './context.js';
import { safetyHandlers } from './safety.js';
import { planningHandlers } from './planning.js';
import { maintenanceHandlers } from './maintenance.js';
import { advancedHandlers } from './advanced.js';
import { integrationHandlers } from './integration.js';

export const HANDLERS = {
  ...coreHandlers,
  ...recordingHandlers,
  ...contextHandlers,
  ...safetyHandlers,
  ...planningHandlers,
  ...maintenanceHandlers,
  ...advancedHandlers,
  ...integrationHandlers,
};
```

- [ ] **Step 3: Add tool definitions to mcp-server.js**

Add these 4 tool definitions to the TOOLS array (before the closing `]`):

```javascript
  {
    name: 'brain_sync',
    description: 'Sync external docs (superpowers specs/plans) to brain entries. Auto-runs on overview, but can be called manually to force sync.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_get_environment',
    description: 'Get environment info: available MCP servers, superpowers skills, custom agents. Scans and caches to environment.json.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_scan_environment',
    description: 'Force rescan of environment (MCP servers, skills, agents). Updates .brain/environment.json.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_record_research',
    description: 'Record a research process — alternatives explored, rejected options with reasons, and final conclusion. Use when evaluating multiple approaches before making a decision.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Research topic title' },
        alternatives: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Alternative name' },
              description: { type: 'string', description: 'What this alternative is' }
            },
            required: ['name', 'description']
          },
          description: 'Alternatives that were explored'
        },
        rejected: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Rejected alternative name' },
              reason: { type: 'string', description: 'Why it was rejected' }
            },
            required: ['name', 'reason']
          },
          description: 'Which alternatives were rejected and why'
        },
        conclusion: { type: 'string', description: 'Final conclusion / chosen approach' },
        agent_data: { type: 'string', description: 'Data from subagent research (optional)' },
        tags: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' }, description: 'Related files' },
        related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          }
        }
      },
      required: ['title', 'alternatives', 'conclusion']
    }
  },
```

- [ ] **Step 4: Add auto-sync to brain_get_overview handler**

In `lib/handlers/core.js`, modify `brain_get_overview` to call sync and auto-overview. Add imports at top:

```javascript
import { SyncEngine } from '../integrations/sync-engine.js';
import { AutoOverview } from '../auto-overview.js';
```

Add at the beginning of the `brain_get_overview` handler (after `const { manager } = ctx;`):

```javascript
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
```

- [ ] **Step 5: Update entryIdPattern in schemas.js**

Update the regex to include RES prefix:

```javascript
const entryIdPattern = /^(DEC|BUG|IMPL|PAT|PLAN|LES|RES)-\d{3,}$/;
```

- [ ] **Step 6: Update search type enum in schemas.js**

Update SearchSchema type enum to include 'research':

```javascript
type: z.enum(['decision', 'bug', 'implementation', 'pattern', 'plan', 'lesson', 'research']).optional(),
```

Also update the `brain_search` and `brain_list` tool definitions in `mcp-server.js` to include 'research' in the type enum.

- [ ] **Step 7: Commit**

```bash
git add lib/handlers/integration.js lib/handlers/index.js lib/handlers/core.js mcp-server.js lib/schemas.js
git commit -m "feat: register 4 new integration tools and wire auto-sync into overview"
```

---

### Task 7: Integration Tests

**Files:**
- Create: `tests/integration-hub.test.js`

- [ ] **Step 1: Write integration tests for full flow**

```javascript
// tests/integration-hub.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainManager } from '../lib/brain-manager.js';
import { SyncEngine } from '../lib/integrations/sync-engine.js';
import { AutoOverview } from '../lib/auto-overview.js';
import { EnvironmentScanner } from '../lib/integrations/environment-scanner.js';
import { SessionIntegrator } from '../lib/integrations/session-integrator.js';

describe('Integration: Full sync → overview pipeline', () => {
  let tempDir, manager;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'integration-full-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'IntegrationTest',
      overview: '# IntegrationTest\n\n> Projekti\n',
      paths: [{ path: tempDir, label: 'root' }]
    });

    // Create superpowers docs
    await mkdir(join(tempDir, 'docs', 'superpowers', 'specs'), { recursive: true });
    await mkdir(join(tempDir, 'docs', 'superpowers', 'plans'), { recursive: true });

    await writeFile(join(tempDir, 'docs', 'superpowers', 'specs', '2026-04-15-auth-design.md'),
      '# Auth System Design\n\n## Summary\nJWT-based authentication with refresh tokens.\n\n## Files\n- `src/auth.rs`\n- `web/Login.tsx`\n');

    await writeFile(join(tempDir, 'docs', 'superpowers', 'plans', '2026-04-15-auth-plan.md'),
      '# Auth System\n\n### Task 1: Setup\n- [x] **Step 1: Install**\n\n### Task 2: Implement\n- [x] **Step 1: Build**\n- [x] **Step 2: Test**\n');

    // Create a decision to enrich the overview
    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Use JWT for auth',
      frontmatter: { status: 'active', tags: ['auth'], files: ['src/auth.rs'], related: [] },
      body: '## Context\nNeed auth.\n\n## Decision\nUse JWT.\n'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('syncs superpowers docs and generates overview in one pipeline', async () => {
    // Step 1: Sync
    const engine = new SyncEngine(manager);
    const syncResults = await engine.runSync();
    assert.equal(syncResults.created, 2);

    // Step 2: Generate overview
    const autoOverview = new AutoOverview(manager);
    const text = await autoOverview.generate();

    assert.ok(text.includes('# IntegrationTest'));
    assert.ok(text.includes('Rust') || text.includes('TypeScript'));
    assert.ok(text.includes('Auth'));
  });

  it('overview includes synced plans in Active Plans section', async () => {
    const autoOverview = new AutoOverview(manager);
    const text = await autoOverview.generate();

    // The auth plan was fully completed, so it won't show in active plans
    // But the auth spec (status: active) should appear or the decision
    assert.ok(text.includes('DEC-001'));
  });
});

describe('Integration: Research → Decision link', () => {
  let tempDir, manager;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'integration-research-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'ResearchTest',
      overview: '# ResearchTest',
      paths: [{ path: tempDir, label: 'root' }]
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('research entry links to subsequent decision', async () => {
    const integrator = new SessionIntegrator(manager);

    // Record research
    const research = await integrator.recordResearch({
      title: 'Database choice evaluation',
      alternatives: [
        { name: 'PostgreSQL', description: 'Full-featured RDBMS' },
        { name: 'SQLite', description: 'Embedded, simple' }
      ],
      rejected: [{ name: 'PostgreSQL', reason: 'Overkill for single-user app' }],
      conclusion: 'SQLite is the right choice for this project',
      tags: ['database']
    });

    // Record decision that references the research
    const decision = await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Use SQLite for storage',
      frontmatter: {
        status: 'active', tags: ['database'], files: ['src/db.rs'],
        related: [{ id: research.id, rel: 'caused_by' }]
      },
      body: '## Decision\nUse SQLite.\n'
    });

    // Verify linkage
    const index = await manager.loadIndex();
    const decEntry = index.entries.find(e => e.id === decision.id);
    assert.ok(decEntry.related.some(r => r.id === research.id));
  });
});

describe('Integration: Environment scan + overview includes tools', () => {
  let tempDir, manager;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'integration-env-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'EnvTest',
      overview: '# EnvTest',
      paths: [{ path: tempDir, label: 'root' }]
    });

    // Create mock settings
    await mkdir(join(tempDir, '.claude'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: { brain: { command: 'node', args: ['mcp-server.js'] } }
    }));
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('environment scan saves to .brain/environment.json', async () => {
    const scanner = new EnvironmentScanner(tempDir);
    await scanner.scanAndSave(manager.brainPath);

    const envData = JSON.parse(await readFile(join(manager.brainPath, 'environment.json'), 'utf-8'));
    assert.equal(envData.version, 1);
    assert.ok(envData.mcp_servers.some(s => s.name === 'brain'));
  });
});
```

- [ ] **Step 2: Run all integration tests**

Run: `node --test tests/integration-hub.test.js`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite to check regressions**

Run: `node --test tests/brain.test.js tests/graph.test.js tests/validation.test.js tests/performance.test.js tests/handlers.test.js tests/libs.test.js tests/superpowers-sync.test.js tests/sync-engine.test.js tests/environment-scanner.test.js tests/auto-overview.test.js tests/session-integrator.test.js tests/integration-hub.test.js`
Expected: All 189+ existing tests PASS + all new tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration-hub.test.js
git commit -m "test: add integration tests for full sync/overview/research pipeline"
```

---

### Task 8: Update Tool Count in mcp-server.js Header and CLAUDE.md Template

**Files:**
- Modify: `mcp-server.js:3-15` — update tool count comment
- Modify: `templates/` — update CLAUDE.md template with new session start instructions

- [ ] **Step 1: Update mcp-server.js header comment**

Update the comment block at the top:

```javascript
/**
 * Brain MCP Server — Autonomous context management for AI coding agents
 *
 * 39 tools organized in categories:
 *   Core (5):        overview, search, get_entry, list, get_lessons
 *   Recording (5):   record_decision, record_bug, record_implementation, record_pattern, record_lesson
 *   Context (4):     link_entries, get_context_for_files, traverse_graph, check_conflicts
 *   Safety (4):      preflight, validate_change, rebuild_rules, restore_snapshot
 *   Planning (4):    record_plan, update_plan, get_backlog, get_session_summary
 *   Integration (4): sync, get_environment, scan_environment, record_research
 *   Maintenance (5): update_entry, review_entry, health, get_history, auto_document
 *   Advanced (8):    visualize, mine_sessions, coordinate_team, rebuild_index,
 *                    get_metrics, create_snapshot, list_snapshots, update
 */
```

- [ ] **Step 2: Update CLAUDE.md template with new session start instructions**

Find the CLAUDE.md template in `templates/` and update the "At session start" section:

```markdown
### At session start
1. Call `brain_get_overview` to get the project overview (auto-syncs superpowers docs + auto-generates overview if stale)
2. Call `brain_get_lessons` to review learned lessons — DO NOT repeat past mistakes
3. Call `brain_get_backlog` to see incomplete plans and deferred tasks
4. Call `brain_get_environment` to know available tools, skills, and agents
5. Evaluate if any deferred task is now relevant
6. DO NOT read .brain/ files directly — use MCP tools
```

Add a new section:

```markdown
### Research and exploration
When evaluating multiple approaches before making a decision:
1. Call `brain_record_research` with alternatives explored, rejected options, and conclusion
2. Link the research entry to the resulting decision with `brain_link_entries`
```

- [ ] **Step 3: Commit**

```bash
git add mcp-server.js templates/
git commit -m "docs: update tool count, CLAUDE.md template with integration instructions"
```

---

### Task 9: Regression Test Run and Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass, no regressions

- [ ] **Step 2: Verify with a mock Classic AP structure**

Create a temporary test that simulates Classic AP's 17 specs:

```bash
node -e "
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainManager } from './lib/brain-manager.js';
import { SyncEngine } from './lib/integrations/sync-engine.js';

const tempDir = await mkdtemp(join(tmpdir(), 'classic-ap-sim-'));
const manager = new BrainManager(tempDir);
await manager.initBrain({ projectName: 'Classic AP Sim', overview: '# Classic AP', paths: [{ path: tempDir, label: 'root' }] });

await mkdir(join(tempDir, 'docs', 'superpowers', 'specs'), { recursive: true });
for (let i = 1; i <= 17; i++) {
  await writeFile(join(tempDir, 'docs', 'superpowers', 'specs', '2026-04-${String(i).padStart(2, \"0\")}-feature-${i}-design.md'),
    '# Feature ${i} Design\n\n## Summary\nFeature ${i} implementation.\n');
}

const engine = new SyncEngine(manager);
const results = await engine.runSync();
console.log('Sync results:', results);
console.assert(results.created === 17, 'Expected 17 created entries');

const index = await manager.loadIndex();
console.log('Total entries:', index.entries.length);
console.assert(index.entries.length === 17, 'Expected 17 total entries');

await rm(tempDir, { recursive: true, force: true });
console.log('SUCCESS: 17 specs synced correctly');
"
```

Expected: "SUCCESS: 17 specs synced correctly"

- [ ] **Step 3: Final commit with all changes**

```bash
git add -A
git status
# If any uncommitted changes remain, commit them:
git commit -m "chore: final integration hub verification pass"
```

---

## File Structure Summary

```
lib/
├── integrations/
│   ├── sync-engine.js          # NEW: Orchestrates all sync sources
│   ├── superpowers-sync.js     # NEW: Parses and syncs docs/superpowers/
│   ├── environment-scanner.js  # NEW: Discovers MCP/skills/agents
│   └── session-integrator.js   # NEW: Records research processes
├── auto-overview.js            # NEW: Generates overview.md from brain
├── handlers/
│   ├── integration.js          # NEW: 4 new tool handlers
│   ├── index.js                # MODIFIED: imports integration handlers
│   └── core.js                 # MODIFIED: auto-sync in overview
├── brain-manager.js            # MODIFIED: RES counter
├── schemas.js                  # MODIFIED: RecordResearchSchema, RES in ID pattern
└── utils/
    └── body-builders.js        # MODIFIED: buildResearchBody

tests/
├── superpowers-sync.test.js    # NEW
├── sync-engine.test.js         # NEW
├── environment-scanner.test.js # NEW
├── auto-overview.test.js       # NEW
├── session-integrator.test.js  # NEW
└── integration-hub.test.js     # NEW
```
