import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeGraph } from '../../lib/code-graph/index.js';

describe('CodeGraph orchestrator', () => {
  let tempDir, brainDir, codeGraph;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'codegraph-test-'));
    brainDir = join(tempDir, '.brain');
    await mkdir(brainDir, { recursive: true });

    // Create test source files
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'main.js'), `
export function greet(name) {
  return formatMessage(name);
}

function formatMessage(name) {
  return 'Hello, ' + name;
}
`);
    await writeFile(join(tempDir, 'src', 'utils.js'), `
export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`);

    codeGraph = new CodeGraph(tempDir, brainDir);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('builds full graph from project', async () => {
    const result = await codeGraph.build();
    assert.ok(result.nodeCount > 0, 'should have nodes');
    assert.ok(result.edgeCount > 0, 'should have edges');
    assert.ok(typeof result.communityCount === 'number');
    assert.ok(typeof result.fileCount === 'number');
  });

  it('saves and loads graph', async () => {
    await codeGraph.build();
    await codeGraph.save();

    const loaded = new CodeGraph(tempDir, brainDir);
    await loaded.load();
    assert.ok(loaded.graph);
    assert.ok(loaded.graph.order > 0);
  });

  it('queries the graph', async () => {
    await codeGraph.build();
    const result = codeGraph.query('greet');
    assert.ok(result.nodes.length > 0);
    assert.ok(result.text.length > 0);
  });

  it('gets stats', async () => {
    await codeGraph.build();
    const stats = codeGraph.getStats();
    assert.ok(stats.nodeCount > 0);
  });

  it('computes blast radius', async () => {
    await codeGraph.build();
    const result = codeGraph.blastRadius(['src/main.js']);
    assert.ok(typeof result.riskScore === 'number');
    assert.ok(result.changedFiles.length > 0);
  });

  it('gets a single node', async () => {
    await codeGraph.build();
    // Find a node that exists
    let existingNodeId = null;
    codeGraph.graph.forEachNode((id, attrs) => {
      if (attrs.type === 'function' && !existingNodeId) existingNodeId = id;
    });
    if (existingNodeId) {
      const node = codeGraph.getNode(existingNodeId);
      assert.ok(node);
      assert.ok(node.label);
      assert.ok(typeof node.degree === 'number');
    }
  });
});
