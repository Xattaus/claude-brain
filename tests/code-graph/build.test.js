import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, resolveReferences, graphToJSON, graphFromJSON } from '../../lib/code-graph/build.js';

describe('buildGraph', () => {
  const extractions = [
    {
      nodes: [
        { id: 'src/a.js', label: 'a.js', type: 'module', file: 'src/a.js', line: 1, language: 'javascript' },
        { id: 'src/a.js::Foo', label: 'Foo', type: 'class', file: 'src/a.js', line: 5, language: 'javascript' },
        { id: 'src/a.js::Foo.bar', label: 'bar', type: 'method', file: 'src/a.js', line: 6, language: 'javascript' },
      ],
      edges: [
        { source: 'src/a.js', target: 'src/a.js::Foo', relation: 'contains', confidence: 'EXTRACTED' },
        { source: 'src/a.js::Foo', target: 'src/a.js::Foo.bar', relation: 'method', confidence: 'EXTRACTED' },
        { source: 'src/a.js', target: '__import__::./b', relation: 'imports', confidence: 'EXTRACTED' },
        { source: 'src/a.js::Foo.bar', target: '__call__::baz', relation: 'calls', confidence: 'INFERRED' },
      ],
    },
    {
      nodes: [
        { id: 'src/b.js', label: 'b.js', type: 'module', file: 'src/b.js', line: 1, language: 'javascript' },
        { id: 'src/b.js::baz', label: 'baz', type: 'function', file: 'src/b.js', line: 3, language: 'javascript' },
      ],
      edges: [
        { source: 'src/b.js', target: 'src/b.js::baz', relation: 'contains', confidence: 'EXTRACTED' },
      ],
    },
  ];

  it('builds a graphology graph from extractions', () => {
    const graph = buildGraph(extractions);
    assert.equal(graph.order, 5, 'should have 5 nodes');
    assert.ok(graph.hasNode('src/a.js'));
    assert.ok(graph.hasNode('src/a.js::Foo'));
    assert.ok(graph.hasNode('src/b.js::baz'));
    assert.equal(graph.getNodeAttribute('src/a.js::Foo', 'type'), 'class');
  });

  it('preserves edge attributes', () => {
    const graph = buildGraph(extractions);
    let containsCount = 0;
    graph.forEachEdge((edge, attrs) => {
      if (attrs.relation === 'contains') containsCount++;
    });
    assert.ok(containsCount >= 2);
  });

  it('resolves call references to known functions', () => {
    const graph = buildGraph(extractions);
    resolveReferences(graph);

    let hasResolvedCall = false;
    graph.forEachEdge((e, a, source, target) => {
      if (a.relation === 'calls' && target === 'src/b.js::baz') hasResolvedCall = true;
    });
    assert.ok(hasResolvedCall, 'should resolve baz call to src/b.js::baz');
  });

  it('deduplicates nodes with same id', () => {
    const dupeExtractions = [
      { nodes: [{ id: 'x', label: 'X', type: 'class' }], edges: [] },
      { nodes: [{ id: 'x', label: 'X', type: 'class' }], edges: [] },
    ];
    const graph = buildGraph(dupeExtractions);
    assert.equal(graph.order, 1, 'should deduplicate');
  });

  it('serializes and deserializes graph', () => {
    const graph = buildGraph(extractions);
    resolveReferences(graph);
    const json = graphToJSON(graph);
    const restored = graphFromJSON(json);
    assert.equal(restored.order, graph.order);
    assert.equal(restored.size, graph.size);
  });
});
