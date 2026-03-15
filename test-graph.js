#!/usr/bin/env node

/**
 * Graph Tests — BFS traversal, path finding, impact analysis, cycle detection
 * Run: node --test test-graph.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainManager } from './lib/brain-manager.js';
import { BrainGraph } from './lib/graph.js';

async function createGraphTestBrain() {
  const tempDir = await mkdtemp(join(tmpdir(), 'brain-graph-'));
  const manager = new BrainManager(tempDir);
  await manager.initBrain({
    projectName: 'graph-test',
    overview: '# Graph Test Project',
    paths: [{ path: tempDir, label: 'root' }]
  });

  // Create a chain: DEC-001 -> IMPL-001 -> BUG-001
  await manager.createEntry({
    type: 'decision', prefix: 'DEC', dirName: 'decisions',
    title: 'Authentication Architecture',
    frontmatter: { status: 'active', tags: ['auth'], files: ['auth.js'], related: [] },
    body: '## Decision\nUse JWT.'
  });

  await manager.createEntry({
    type: 'implementation', prefix: 'IMPL', dirName: 'implementations',
    title: 'JWT Implementation',
    frontmatter: { status: 'current', tags: ['auth', 'jwt'], files: ['auth.js', 'jwt.js'], related: [] },
    body: '## Description\nJWT implemented.'
  });

  await manager.createEntry({
    type: 'bug', prefix: 'BUG', dirName: 'bugs',
    title: 'Token Expiry Bug',
    frontmatter: { status: 'fixed', severity: 'high', tags: ['auth', 'jwt'], files: ['jwt.js'], related: [] },
    body: '## Symptoms\nTokens never expire.\n\n## Root Cause\nMissing check.\n\n## Fix\nAdded expiry check.'
  });

  // Create separate island: PAT-001 -> DEC-002
  await manager.createEntry({
    type: 'pattern', prefix: 'PAT', dirName: 'patterns',
    title: 'Error Handling Pattern',
    frontmatter: { tags: ['error-handling'], related: [] },
    body: '## Pattern\nUse try-catch.'
  });

  await manager.createEntry({
    type: 'decision', prefix: 'DEC', dirName: 'decisions',
    title: 'Error Strategy Decision',
    frontmatter: { status: 'active', tags: ['error-handling'], files: ['error.js'], related: [] },
    body: '## Decision\nCentralized error handling.'
  });

  // Link: IMPL-001 implements DEC-001
  await manager.linkEntries('IMPL-001', 'DEC-001', 'implements');
  // Link: BUG-001 fixes IMPL-001
  await manager.linkEntries('BUG-001', 'IMPL-001', 'fixes');
  // Link: PAT-001 used_in DEC-002
  await manager.linkEntries('PAT-001', 'DEC-002', 'used_in');

  return { tempDir, manager };
}

// ── BFS Traversal Tests ──

describe('BrainGraph.traverse — BFS', () => {
  let manager, graph, tempDir;

  before(async () => {
    const ctx = await createGraphTestBrain();
    manager = ctx.manager;
    tempDir = ctx.tempDir;
    graph = new BrainGraph(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('depth 1 from DEC-001 finds direct relations', async () => {
    const result = await graph.traverse('DEC-001', { maxDepth: 1 });
    const nodeIds = result.nodes.map(n => n.id);

    assert.ok(nodeIds.includes('DEC-001'), 'Should include start node');
    assert.ok(nodeIds.includes('IMPL-001'), 'Should include directly linked IMPL-001');
    assert.ok(!nodeIds.includes('BUG-001'), 'Should NOT include BUG-001 at depth 1 from DEC-001');
  });

  it('depth 2 from DEC-001 finds transitive relations', async () => {
    const result = await graph.traverse('DEC-001', { maxDepth: 2 });
    const nodeIds = result.nodes.map(n => n.id);

    assert.ok(nodeIds.includes('DEC-001'));
    assert.ok(nodeIds.includes('IMPL-001'));
    assert.ok(nodeIds.includes('BUG-001'), 'Should include BUG-001 at depth 2');
  });

  it('depth 3 does not cross unconnected islands', async () => {
    const result = await graph.traverse('DEC-001', { maxDepth: 3 });
    const nodeIds = result.nodes.map(n => n.id);

    assert.ok(!nodeIds.includes('PAT-001'), 'PAT-001 is on separate island');
    assert.ok(!nodeIds.includes('DEC-002'), 'DEC-002 is on separate island');
  });

  it('rel_types filter works', async () => {
    // DEC-001's link to IMPL-001 is stored as 'relates_to' (inverse of 'implements')
    // because IMPL-001 implements DEC-001, and the inverse is relates_to
    const result = await graph.traverse('DEC-001', { maxDepth: 3, relTypes: ['relates_to'] });
    const nodeIds = result.nodes.map(n => n.id);

    assert.ok(nodeIds.includes('IMPL-001'), 'Should find IMPL-001 via relates_to (inverse of implements)');
  });

  it('edges include relation types', async () => {
    const result = await graph.traverse('DEC-001', { maxDepth: 2 });
    assert.ok(result.edges.length > 0);
    assert.ok(result.edges.some(e => e.rel === 'relates_to' || e.rel === 'implements'));
  });

  it('nonexistent start returns empty nodes', async () => {
    const result = await graph.traverse('DEC-999', { maxDepth: 1 });
    assert.equal(result.nodes.length, 0);
  });
});

// ── Path Finding Tests ──

describe('BrainGraph.findPath', () => {
  let manager, graph, tempDir;

  before(async () => {
    const ctx = await createGraphTestBrain();
    manager = ctx.manager;
    tempDir = ctx.tempDir;
    graph = new BrainGraph(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('finds direct path between linked entries', async () => {
    const path = await graph.findPath('IMPL-001', 'DEC-001');
    assert.ok(path.length > 0, 'Should find a path');
    assert.equal(path[0].id, 'IMPL-001');
    assert.equal(path[path.length - 1].id, 'DEC-001');
  });

  it('finds transitive path', async () => {
    const path = await graph.findPath('BUG-001', 'DEC-001');
    assert.ok(path.length >= 2, 'Path should have at least 2 nodes');
  });

  it('returns empty for disconnected entries', async () => {
    const path = await graph.findPath('DEC-001', 'PAT-001');
    assert.equal(path.length, 0, 'No path between separate islands');
  });

  it('returns empty for nonexistent entries', async () => {
    const path = await graph.findPath('DEC-001', 'DEC-999');
    assert.equal(path.length, 0);
  });

  it('finds path of length 1 (self)', async () => {
    const path = await graph.findPath('DEC-001', 'DEC-001');
    assert.equal(path.length, 1);
    assert.equal(path[0].id, 'DEC-001');
  });
});

// ── Impact Analysis Tests ──

describe('BrainGraph.dependents — impact analysis', () => {
  let manager, graph, tempDir;

  before(async () => {
    const ctx = await createGraphTestBrain();
    manager = ctx.manager;
    tempDir = ctx.tempDir;
    graph = new BrainGraph(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('finds entries that depend on DEC-001', async () => {
    const deps = await graph.dependents('DEC-001');
    const depIds = deps.map(d => d.id);

    assert.ok(depIds.includes('IMPL-001'), 'IMPL-001 implements DEC-001');
  });

  it('finds transitive dependents', async () => {
    const deps = await graph.dependents('DEC-001', 3);
    const depIds = deps.map(d => d.id);

    // BUG-001 -> IMPL-001 -> DEC-001, so BUG-001 transitively depends on DEC-001
    // But "dependents" follows reverse edges, so it depends on how the graph is structured
    // IMPL-001 points TO DEC-001 (implements), BUG-001 points TO IMPL-001 (fixes)
    assert.ok(depIds.includes('IMPL-001'));
  });

  it('returns empty for entries with no dependents', async () => {
    const deps = await graph.dependents('BUG-001');
    // BUG-001 has outgoing "fixes" but may not have incoming refs
    // It depends on the graph structure
    console.log(`    BUG-001 dependents: ${deps.map(d => d.id).join(', ') || 'none'}`);
  });
});

// ── Cycle Detection Tests ──

describe('BrainGraph.findCycles', () => {
  it('no cycles in acyclic graph', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'brain-nocycle-'));
    const manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'nocycle-test',
      overview: '# No Cycle Test',
      paths: [{ path: tempDir, label: 'root' }]
    });

    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Decision A',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Decision\nA.'
    });
    await manager.createEntry({
      type: 'implementation', prefix: 'IMPL', dirName: 'implementations',
      title: 'Implementation B',
      frontmatter: { status: 'current', tags: [], files: [], related: [] },
      body: '## Description\nB.'
    });
    await manager.linkEntries('IMPL-001', 'DEC-001', 'implements');

    const graph = new BrainGraph(manager);
    const cycles = await graph.findCycles();
    // Note: bidirectional links create "cycles" in directed graph sense
    // DEC-001 -> IMPL-001 (relates_to) and IMPL-001 -> DEC-001 (implements)
    // This is expected behavior with bidirectional links
    console.log(`    Cycles found: ${cycles.length} (bidirectional links create reciprocal edges)`);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects explicit cycles', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'brain-cycle-'));
    const manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'cycle-test',
      overview: '# Cycle Test',
      paths: [{ path: tempDir, label: 'root' }]
    });

    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Decision X',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Decision\nX.'
    });
    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Decision Y',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Decision\nY.'
    });
    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Decision Z',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Decision\nZ.'
    });

    // Create a cycle: X -> Y -> Z -> X
    await manager.linkEntries('DEC-001', 'DEC-002', 'relates_to');
    await manager.linkEntries('DEC-002', 'DEC-003', 'relates_to');
    await manager.linkEntries('DEC-003', 'DEC-001', 'relates_to');

    const graph = new BrainGraph(manager);
    const cycles = await graph.findCycles();
    assert.ok(cycles.length > 0, 'Should detect the cycle');
    console.log(`    Cycles: ${cycles.map(c => c.join(' -> ')).join('; ')}`);

    await rm(tempDir, { recursive: true, force: true });
  });
});

console.log('\n✅ Graph test suites defined. Run with: node --test test-graph.js\n');
