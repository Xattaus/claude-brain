import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';
import { detectCommunities, getCommunityStats } from '../../lib/code-graph/cluster.js';

function buildTestGraph() {
  const graph = new Graph({ multi: true, type: 'directed' });

  // Cluster A: tightly connected
  graph.addNode('a1', { label: 'a1', type: 'function', file: 'a.js' });
  graph.addNode('a2', { label: 'a2', type: 'function', file: 'a.js' });
  graph.addNode('a3', { label: 'a3', type: 'function', file: 'a.js' });
  graph.addEdge('a1', 'a2', { relation: 'calls' });
  graph.addEdge('a2', 'a3', { relation: 'calls' });
  graph.addEdge('a3', 'a1', { relation: 'calls' });

  // Cluster B: tightly connected
  graph.addNode('b1', { label: 'b1', type: 'function', file: 'b.js' });
  graph.addNode('b2', { label: 'b2', type: 'function', file: 'b.js' });
  graph.addNode('b3', { label: 'b3', type: 'function', file: 'b.js' });
  graph.addEdge('b1', 'b2', { relation: 'calls' });
  graph.addEdge('b2', 'b3', { relation: 'calls' });
  graph.addEdge('b3', 'b1', { relation: 'calls' });

  // Weak link between clusters
  graph.addEdge('a1', 'b1', { relation: 'calls' });

  return graph;
}

describe('detectCommunities', () => {
  it('assigns community attribute to all nodes', () => {
    const graph = buildTestGraph();
    const result = detectCommunities(graph);

    graph.forEachNode((id) => {
      const community = graph.getNodeAttribute(id, 'community');
      assert.ok(community !== undefined, `${id} should have community attr`);
    });
    assert.ok(result.count >= 1, 'should find at least 1 community');
  });

  it('groups tightly-connected nodes together', () => {
    const graph = buildTestGraph();
    detectCommunities(graph);

    const communityA = graph.getNodeAttribute('a1', 'community');
    assert.equal(graph.getNodeAttribute('a2', 'community'), communityA);
    assert.equal(graph.getNodeAttribute('a3', 'community'), communityA);

    const communityB = graph.getNodeAttribute('b1', 'community');
    assert.equal(graph.getNodeAttribute('b2', 'community'), communityB);
  });

  it('returns community stats', () => {
    const graph = buildTestGraph();
    detectCommunities(graph);
    const stats = getCommunityStats(graph);

    assert.ok(stats.communities.length >= 1);
    for (const c of stats.communities) {
      assert.ok(c.id !== undefined);
      assert.ok(c.size > 0);
      assert.ok(Array.isArray(c.nodes));
    }
  });
});
