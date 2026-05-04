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
