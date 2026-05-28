import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASTCache } from '../../lib/code-graph/cache.js';

describe('ASTCache', () => {
  let tempDir, cache;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cache-test-'));
    cache = new ASTCache(tempDir);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves cached extractions', async () => {
    const content = 'function foo() { return 1; }';
    const extraction = {
      nodes: [{ id: 'test::foo', label: 'foo', type: 'function' }],
      edges: [],
    };

    await cache.set(content, extraction);
    const cached = await cache.get(content);

    assert.deepEqual(cached, extraction);
  });

  it('returns null for cache miss', async () => {
    const result = await cache.get('unknown content');
    assert.equal(result, null);
  });

  it('invalidates on content change', async () => {
    const content1 = 'const a = 1;';
    const content2 = 'const a = 2;';
    const extraction = { nodes: [], edges: [] };

    await cache.set(content1, extraction);
    const hit = await cache.get(content1);
    const miss = await cache.get(content2);

    assert.deepEqual(hit, extraction);
    assert.equal(miss, null);
  });

  it('checks freshness by stat (mtime + size)', async () => {
    const filePath = join(tempDir, 'test.js');
    await writeFile(filePath, 'const x = 1;');

    // Store with current stat
    await cache.setWithStat(filePath, 'const x = 1;', { nodes: [], edges: [] });
    const fresh = await cache.isFreshByStat(filePath);
    assert.equal(fresh, true);
  });

  it('getOrExtract returns cached result on hit', async () => {
    const content = 'function cached() {}';
    const extraction = { nodes: [{ id: 'cached' }], edges: [] };
    await cache.set(content, extraction);

    let extractCalled = false;
    const result = await cache.getOrExtract('fake-path', content, async () => {
      extractCalled = true;
      return { nodes: [{ id: 'new' }], edges: [] };
    });

    assert.deepEqual(result, extraction);
    assert.equal(extractCalled, false, 'extract function should not be called on cache hit');
  });

  it('getOrExtract calls extract on miss', async () => {
    const content = 'function brand_new() {}';
    const extraction = { nodes: [{ id: 'new' }], edges: [] };

    let extractCalled = false;
    const result = await cache.getOrExtract('fake-path2', content, async () => {
      extractCalled = true;
      return extraction;
    });

    assert.deepEqual(result, extraction);
    assert.equal(extractCalled, true, 'extract function should be called on cache miss');
  });
});
