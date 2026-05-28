import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Graph from 'graphology';
import { BridgeManager } from '../../lib/code-graph/bridge.js';

describe('BridgeManager', () => {
  let tempDir, bridge;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bridge-test-'));
    bridge = new BridgeManager(join(tempDir, 'bridges.json'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a manual bridge', async () => {
    await bridge.addBridge({
      brainId: 'DEC-001',
      codeNodes: ['src/auth.js::login'],
      relation: 'documents',
      auto: false,
    });
    const bridges = await bridge.getBridges();
    assert.equal(bridges.length, 1);
    assert.equal(bridges[0].brainId, 'DEC-001');
    assert.deepEqual(bridges[0].codeNodes, ['src/auth.js::login']);
  });

  it('finds bridges for a brain entry', async () => {
    const found = await bridge.getBridgesForEntry('DEC-001');
    assert.equal(found.length, 1);
  });

  it('finds bridges for a code node', async () => {
    const found = await bridge.getBridgesForCodeNode('src/auth.js::login');
    assert.equal(found.length, 1);
    assert.equal(found[0].brainId, 'DEC-001');
  });

  it('auto-detects bridges from file matches', async () => {
    const graph = new Graph({ multi: true, type: 'directed' });
    graph.addNode('src/auth.js::Foo', { label: 'Foo', type: 'class', file: 'src/auth.js' });
    graph.addNode('src/db.js::Bar', { label: 'Bar', type: 'class', file: 'src/db.js' });

    const brainEntries = [
      { id: 'DEC-002', files: ['src/auth.js'], title: 'Auth design' },
      { id: 'BUG-001', files: ['src/db.js', 'src/other.js'], title: 'DB bug' },
    ];

    const autoBridges = await bridge.autoDetect(graph, brainEntries);
    assert.ok(autoBridges.length >= 2);

    const dec002 = autoBridges.find(b => b.brainId === 'DEC-002');
    assert.ok(dec002);
    assert.ok(dec002.codeNodes.includes('src/auth.js::Foo'));
  });

  it('avoids duplicate bridges', async () => {
    await bridge.addBridge({
      brainId: 'DEC-001',
      codeNodes: ['src/auth.js::login'],
      relation: 'documents',
    });
    const bridges = await bridge.getBridges();
    const dec001Bridges = bridges.filter(b => b.brainId === 'DEC-001' && b.codeNodes[0] === 'src/auth.js::login');
    assert.equal(dec001Bridges.length, 1, 'should not duplicate');
  });
});
