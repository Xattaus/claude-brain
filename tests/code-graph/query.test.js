import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';
import { queryGraph, findShortestPath, getNeighbors } from '../../lib/code-graph/query.js';

function buildTestGraph() {
  const graph = new Graph({ multi: true, type: 'directed' });
  graph.addNode('src/auth.js', { label: 'auth.js', type: 'module', file: 'src/auth.js', language: 'javascript', community: 0 });
  graph.addNode('src/auth.js::login', { label: 'login', type: 'function', file: 'src/auth.js', language: 'javascript', community: 0 });
  graph.addNode('src/auth.js::verify', { label: 'verify', type: 'function', file: 'src/auth.js', language: 'javascript', community: 0 });
  graph.addNode('src/db.js', { label: 'db.js', type: 'module', file: 'src/db.js', language: 'javascript', community: 1 });
  graph.addNode('src/db.js::query', { label: 'query', type: 'function', file: 'src/db.js', language: 'javascript', community: 1 });
  graph.addNode('src/utils.js', { label: 'utils.js', type: 'module', file: 'src/utils.js', language: 'javascript', community: 2 });

  graph.addEdge('src/auth.js', 'src/auth.js::login', { relation: 'contains', confidence: 'EXTRACTED' });
  graph.addEdge('src/auth.js', 'src/auth.js::verify', { relation: 'contains', confidence: 'EXTRACTED' });
  graph.addEdge('src/auth.js::login', 'src/auth.js::verify', { relation: 'calls', confidence: 'EXTRACTED' });
  graph.addEdge('src/auth.js::login', 'src/db.js::query', { relation: 'calls', confidence: 'INFERRED' });
  graph.addEdge('src/db.js', 'src/db.js::query', { relation: 'contains', confidence: 'EXTRACTED' });
  graph.addEdge('src/auth.js', 'src/db.js', { relation: 'imports', confidence: 'EXTRACTED' });

  return graph;
}

describe('queryGraph', () => {
  it('finds relevant nodes by query string', () => {
    const graph = buildTestGraph();
    const result = queryGraph(graph, 'login authentication');
    assert.ok(result.nodes.length > 0);
    const labels = result.nodes.map(n => n.label);
    assert.ok(labels.includes('login'), 'should find login');
  });

  it('respects token budget', () => {
    const graph = buildTestGraph();
    const result = queryGraph(graph, 'login', { budget: 100 });
    assert.ok(result.text.length <= 500, 'text should be within budget');
  });

  it('returns both nodes and formatted text', () => {
    const graph = buildTestGraph();
    const result = queryGraph(graph, 'auth');
    assert.ok(Array.isArray(result.nodes));
    assert.ok(typeof result.text === 'string');
    assert.ok(result.text.length > 0);
  });
});

describe('findShortestPath', () => {
  it('finds path between two nodes', () => {
    const graph = buildTestGraph();
    const path = findShortestPath(graph, 'src/auth.js::login', 'src/db.js::query');
    assert.ok(path.length >= 2);
    assert.equal(path[0], 'src/auth.js::login');
    assert.equal(path[path.length - 1], 'src/db.js::query');
  });

  it('returns empty array for unreachable nodes', () => {
    const graph = buildTestGraph();
    const path = findShortestPath(graph, 'src/utils.js', 'src/auth.js::login');
    assert.deepEqual(path, []);
  });
});

describe('getNeighbors', () => {
  it('returns neighbors with relation types', () => {
    const graph = buildTestGraph();
    const neighbors = getNeighbors(graph, 'src/auth.js::login');
    assert.ok(neighbors.length > 0);
    const rels = neighbors.map(n => n.relation);
    assert.ok(rels.includes('calls'));
  });

  it('filters by relation type', () => {
    const graph = buildTestGraph();
    const neighbors = getNeighbors(graph, 'src/auth.js::login', { relation: 'calls' });
    for (const n of neighbors) {
      assert.equal(n.relation, 'calls');
    }
  });
});
