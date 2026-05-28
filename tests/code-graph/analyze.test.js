import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';
import { findGodNodes, findSurprises, getGraphStats, computeBlastRadius } from '../../lib/code-graph/analyze.js';

function buildTestGraph() {
  const graph = new Graph({ multi: true, type: 'directed' });
  graph.addNode('hub', { label: 'Hub', type: 'class', file: 'hub.js', language: 'javascript', community: 0 });
  for (let i = 0; i < 20; i++) {
    const id = `node${i}`;
    graph.addNode(id, { label: `Node${i}`, type: 'function', file: `file${i}.js`, language: 'javascript', community: i % 3 });
    graph.addEdge(id, 'hub', { relation: 'calls', confidence: 'EXTRACTED' });
  }
  graph.addNode('pyNode', { label: 'py_func', type: 'function', file: 'util.py', language: 'python', community: 5 });
  graph.addEdge('hub', 'pyNode', { relation: 'references', confidence: 'AMBIGUOUS' });
  return graph;
}

describe('findGodNodes', () => {
  it('identifies highly connected nodes', () => {
    const graph = buildTestGraph();
    const gods = findGodNodes(graph, { minDegree: 10 });
    assert.ok(gods.length > 0);
    assert.equal(gods[0].id, 'hub');
    assert.ok(gods[0].degree >= 20);
  });

  it('returns empty for normal graphs', () => {
    const graph = new Graph({ multi: true, type: 'directed' });
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    graph.addEdge('a', 'b', { relation: 'calls' });
    const gods = findGodNodes(graph);
    assert.equal(gods.length, 0);
  });
});

describe('findSurprises', () => {
  it('finds surprising edges', () => {
    const graph = buildTestGraph();
    const surprises = findSurprises(graph);
    assert.ok(surprises.length > 0);
    const crossLang = surprises.find(s => s.factors.includes('cross-language'));
    assert.ok(crossLang, 'should find cross-language surprise');
  });
});

describe('getGraphStats', () => {
  it('returns comprehensive stats', () => {
    const graph = buildTestGraph();
    const stats = getGraphStats(graph);
    assert.ok(stats.nodeCount > 0);
    assert.ok(stats.edgeCount > 0);
    assert.ok(stats.nodeTypes);
    assert.ok(stats.edgeTypes);
    assert.ok(typeof stats.avgDegree === 'number');
    assert.ok(stats.languages);
  });
});

describe('computeBlastRadius', () => {
  it('calculates affected nodes and communities', () => {
    const graph = buildTestGraph();
    const result = computeBlastRadius(graph, ['hub.js']);
    assert.ok(result.affectedNodeCount > 0);
    assert.ok(result.riskScore >= 0 && result.riskScore <= 100);
    assert.ok(result.changedFiles.includes('hub.js'));
  });

  it('returns zero for unknown files', () => {
    const graph = buildTestGraph();
    const result = computeBlastRadius(graph, ['nonexistent.js']);
    assert.equal(result.affectedNodeCount, 0);
  });
});
