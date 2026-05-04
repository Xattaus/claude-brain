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
    assert.ok(text.toLowerCase().includes('auth'));
  });

  it('overview includes synced plans in Active Plans section', async () => {
    const autoOverview = new AutoOverview(manager);
    const text = await autoOverview.generate();

    // The decision should appear
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
