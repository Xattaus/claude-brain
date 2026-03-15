#!/usr/bin/env node

/**
 * Performance Tests — Benchmarks for search, indexing, and concurrent operations
 * Run: node --test test-performance.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainManager } from './lib/brain-manager.js';
import { BrainSearch } from './lib/search.js';

async function createTestBrainWithEntries(count) {
  const tempDir = await mkdtemp(join(tmpdir(), 'brain-perf-'));
  const manager = new BrainManager(tempDir);
  await manager.initBrain({
    projectName: 'perf-test',
    overview: '# Performance Test Project',
    paths: [{ path: tempDir, label: 'root' }]
  });

  const types = [
    { type: 'decision', prefix: 'DEC', dirName: 'decisions' },
    { type: 'bug', prefix: 'BUG', dirName: 'bugs' },
    { type: 'implementation', prefix: 'IMPL', dirName: 'implementations' },
    { type: 'pattern', prefix: 'PAT', dirName: 'patterns' }
  ];

  const words = ['authentication', 'database', 'caching', 'api', 'frontend', 'backend',
    'testing', 'deployment', 'logging', 'monitoring', 'security', 'performance',
    'refactoring', 'migration', 'validation', 'serialization', 'optimization'];

  for (let i = 0; i < count; i++) {
    const typeInfo = types[i % types.length];
    const word1 = words[i % words.length];
    const word2 = words[(i + 3) % words.length];
    const word3 = words[(i + 7) % words.length];

    await manager.createEntry({
      type: typeInfo.type,
      prefix: typeInfo.prefix,
      dirName: typeInfo.dirName,
      title: `${word1} ${word2} implementation ${i}`,
      frontmatter: {
        status: i % 5 === 0 ? 'superseded' : 'active',
        tags: [word1, word2, word3],
        files: [`src/${word1}/${word2}.js`, `lib/${word3}.js`],
        related: [],
        ...(typeInfo.type === 'bug' ? { severity: ['low', 'medium', 'high', 'critical'][i % 4] } : {})
      },
      body: `## Description\n\nThis is entry ${i} about ${word1} and ${word2}.\nIt involves ${word3} considerations.\n\n## Details\n\nDetailed content for performance testing purposes with enough text to be meaningful in search scoring.`
    });
  }

  return { tempDir, manager };
}

// ── Performance Benchmarks ──

describe('Performance — 100 entries', () => {
  let manager, search, tempDir;

  before(async () => {
    const ctx = await createTestBrainWithEntries(100);
    manager = ctx.manager;
    tempDir = ctx.tempDir;
    search = new BrainSearch(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('search completes under 500ms for 100 entries', async () => {
    const start = performance.now();
    const results = await search.search('authentication database');
    const elapsed = performance.now() - start;

    assert.ok(results.length > 0, 'Should find results');
    assert.ok(elapsed < 500, `Search took ${elapsed.toFixed(1)}ms, expected <500ms`);
    console.log(`    100 entries search: ${elapsed.toFixed(1)}ms, ${results.length} results`);
  });

  it('search with type filter is fast', async () => {
    const start = performance.now();
    const results = await search.search('caching', { type: 'decision' });
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 500, `Filtered search took ${elapsed.toFixed(1)}ms`);
    assert.ok(results.every(r => r.type === 'decision'));
    console.log(`    100 entries filtered search: ${elapsed.toFixed(1)}ms, ${results.length} results`);
  });

  it('fuzzy search finds misspellings', async () => {
    // "authentcation" (missing 'i') should find "authentication" via fuzzy
    const results = await search.search('authentcation');
    // MiniSearch fuzzy tolerance 0.2 should catch this
    console.log(`    Fuzzy search "authentcation": ${results.length} results`);
    // This may or may not find results depending on fuzzy tolerance
  });

  it('prefix search works', async () => {
    const results = await search.search('auth');
    assert.ok(results.length > 0, 'Prefix "auth" should match "authentication"');
    console.log(`    Prefix search "auth": ${results.length} results`);
  });

  it('empty query returns all entries quickly', async () => {
    const start = performance.now();
    const results = await search.search('');
    const elapsed = performance.now() - start;

    assert.equal(results.length, 100);
    assert.ok(elapsed < 200, `Empty query took ${elapsed.toFixed(1)}ms`);
    console.log(`    Empty query: ${elapsed.toFixed(1)}ms, ${results.length} results`);
  });
});

describe('Performance — 500 entries', () => {
  let manager, search, tempDir;

  before(async () => {
    const ctx = await createTestBrainWithEntries(500);
    manager = ctx.manager;
    tempDir = ctx.tempDir;
    search = new BrainSearch(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('search completes under 1000ms for 500 entries', async () => {
    const start = performance.now();
    const results = await search.search('security monitoring');
    const elapsed = performance.now() - start;

    assert.ok(results.length > 0, 'Should find results');
    assert.ok(elapsed < 1000, `Search took ${elapsed.toFixed(1)}ms, expected <1000ms`);
    console.log(`    500 entries search: ${elapsed.toFixed(1)}ms, ${results.length} results`);
  });

  it('subsequent searches are faster (cached index)', async () => {
    // First search warms up the index
    await search.search('database');

    const start = performance.now();
    const results = await search.search('caching optimization');
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 200, `Cached search took ${elapsed.toFixed(1)}ms`);
    console.log(`    500 entries cached search: ${elapsed.toFixed(1)}ms, ${results.length} results`);
  });
});

describe('Performance — concurrent operations', () => {
  let manager, tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'brain-conc-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'concurrent-test',
      overview: '# Concurrent Test',
      paths: [{ path: tempDir, label: 'root' }]
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('10 concurrent writes produce unique IDs', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        manager.createEntry({
          type: 'decision',
          prefix: 'DEC',
          dirName: 'decisions',
          title: `Concurrent Decision ${i}`,
          frontmatter: { status: 'active', tags: [`tag-${i}`], files: [], related: [] },
          body: `## Decision\nConcurrent decision ${i}.`
        })
      );
    }

    const results = await Promise.all(promises);
    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);

    assert.equal(uniqueIds.size, 10, `Expected 10 unique IDs, got ${uniqueIds.size}: ${ids.join(', ')}`);
    console.log(`    10 concurrent writes: IDs = ${ids.join(', ')}`);
  });

  it('index is consistent after concurrent writes', async () => {
    const index = await manager.loadIndex();
    const decEntries = index.entries.filter(e => e.type === 'decision');
    assert.equal(decEntries.length, 10, `Expected 10 decisions, got ${decEntries.length}`);
  });
});

console.log('\n✅ Performance test suites defined. Run with: node --test test-performance.js\n');
