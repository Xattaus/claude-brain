# Code Graph Implementation Plan — Part 2: Advanced Features & Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Community detection, analysis (god nodes, surprise), query engine, bridge system, MCP tools, and full pipeline wiring.

**Prerequisite:** Part 1 complete (Tasks 1–6).

---

### Task 7: Community Detection (Louvain)

**Files:**
- Create: `lib/code-graph/cluster.js`
- Create: `tests/code-graph/cluster.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/cluster.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/cluster.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement cluster.js**

Create `lib/code-graph/cluster.js`:

```javascript
import louvain from 'graphology-communities-louvain';

export function detectCommunities(graph, options = {}) {
  const resolution = options.resolution || 1.0;
  const maxCommunitySize = options.maxCommunitySize || 50;

  // Louvain needs undirected edges — create a copy for community detection
  // but assign results back to the original directed graph
  const communities = louvain.detailed(graph, {
    resolution,
    getEdgeWeight: () => 1,
  });

  // Assign community attribute to each node
  for (const [nodeId, communityId] of Object.entries(communities.communities)) {
    if (graph.hasNode(nodeId)) {
      graph.setNodeAttribute(nodeId, 'community', communityId);
    }
  }

  // Check for oversized communities and re-split
  const communitySizes = new Map();
  for (const [nodeId, communityId] of Object.entries(communities.communities)) {
    if (!communitySizes.has(communityId)) communitySizes.set(communityId, []);
    communitySizes.get(communityId).push(nodeId);
  }

  let nextCommunityId = communities.count;
  for (const [communityId, members] of communitySizes) {
    if (members.length > maxCommunitySize) {
      // Re-split: assign sub-communities based on file grouping
      const fileGroups = new Map();
      for (const nodeId of members) {
        const file = graph.getNodeAttribute(nodeId, 'file') || 'unknown';
        if (!fileGroups.has(file)) fileGroups.set(file, []);
        fileGroups.get(file).push(nodeId);
      }

      if (fileGroups.size > 1) {
        let groupIdx = 0;
        for (const [file, nodes] of fileGroups) {
          const subId = nextCommunityId + groupIdx;
          for (const nodeId of nodes) {
            graph.setNodeAttribute(nodeId, 'community', subId);
          }
          groupIdx++;
        }
        nextCommunityId += groupIdx;
      }
    }
  }

  // Count final communities
  const finalCommunities = new Set();
  graph.forEachNode((id) => {
    finalCommunities.add(graph.getNodeAttribute(id, 'community'));
  });

  return {
    count: finalCommunities.size,
    modularity: communities.modularity,
  };
}

export function getCommunityStats(graph) {
  const communityMap = new Map();

  graph.forEachNode((id, attrs) => {
    const community = attrs.community;
    if (community === undefined) return;
    if (!communityMap.has(community)) {
      communityMap.set(community, {
        id: community,
        nodes: [],
        files: new Set(),
        types: new Map(),
      });
    }
    const c = communityMap.get(community);
    c.nodes.push(id);
    if (attrs.file) c.files.add(attrs.file);
    const type = attrs.type || 'unknown';
    c.types.set(type, (c.types.get(type) || 0) + 1);
  });

  const communities = [];
  for (const [id, data] of communityMap) {
    communities.push({
      id,
      size: data.nodes.length,
      nodes: data.nodes,
      files: [...data.files],
      types: Object.fromEntries(data.types),
    });
  }

  communities.sort((a, b) => b.size - a.size);

  return {
    communities,
    totalCommunities: communities.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/cluster.test.js
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/cluster.js tests/code-graph/cluster.test.js
git commit -m "feat(code-graph): add Louvain community detection

Detects logical clusters in code graph. Auto-splits oversized
communities (>50 nodes) by file grouping. Returns modularity score."
```

---

### Task 8: Analysis (god nodes, surprise edges, stats)

**Files:**
- Create: `lib/code-graph/analyze.js`
- Create: `tests/code-graph/analyze.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/analyze.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';
import { findGodNodes, findSurprises, getGraphStats } from '../../lib/code-graph/analyze.js';

function buildTestGraph() {
  const graph = new Graph({ multi: true, type: 'directed' });

  // Hub node with many connections
  graph.addNode('hub', { label: 'Hub', type: 'class', file: 'hub.js', language: 'javascript', community: 0 });
  for (let i = 0; i < 20; i++) {
    const id = `node${i}`;
    graph.addNode(id, { label: `Node${i}`, type: 'function', file: `file${i}.js`, language: 'javascript', community: i % 3 });
    graph.addEdge(id, 'hub', { relation: 'calls', confidence: 'EXTRACTED' });
  }

  // Surprise: cross-language edge
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

  it('returns empty array for normal graphs', () => {
    const graph = new Graph({ multi: true, type: 'directed' });
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    graph.addEdge('a', 'b', { relation: 'calls' });

    const gods = findGodNodes(graph);
    assert.equal(gods.length, 0);
  });
});

describe('findSurprises', () => {
  it('finds surprising edges (cross-language, cross-community, ambiguous)', () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/analyze.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement analyze.js**

Create `lib/code-graph/analyze.js`:

```javascript
export function findGodNodes(graph, options = {}) {
  const minDegree = options.minDegree || null;
  const percentile = options.percentile || 99;

  const degrees = [];
  graph.forEachNode((id) => {
    degrees.push({ id, degree: graph.degree(id) });
  });

  if (degrees.length === 0) return [];

  degrees.sort((a, b) => b.degree - a.degree);

  let threshold;
  if (minDegree !== null) {
    threshold = minDegree;
  } else {
    const idx = Math.floor(degrees.length * (percentile / 100));
    threshold = degrees[Math.min(idx, degrees.length - 1)].degree;
    threshold = Math.max(threshold, 50); // Minimum threshold
  }

  return degrees
    .filter(d => d.degree >= threshold)
    .map(d => ({
      id: d.id,
      label: graph.getNodeAttribute(d.id, 'label'),
      type: graph.getNodeAttribute(d.id, 'type'),
      file: graph.getNodeAttribute(d.id, 'file'),
      degree: d.degree,
      inDegree: graph.inDegree(d.id),
      outDegree: graph.outDegree(d.id),
    }));
}

export function findSurprises(graph, options = {}) {
  const maxResults = options.maxResults || 20;
  const scored = [];

  graph.forEachEdge((edgeId, attrs, source, target) => {
    let score = 0;
    const factors = [];

    const sourceAttrs = graph.getNodeAttribute(source, 'language') ? graph.getNodeAttributes(source) : {};
    const targetAttrs = graph.getNodeAttribute(target, 'language') ? graph.getNodeAttributes(target) : {};

    // Factor 1: AMBIGUOUS confidence
    if (attrs.confidence === 'AMBIGUOUS') {
      score += 2.0;
      factors.push('ambiguous');
    }

    // Factor 2: Cross-language
    if (sourceAttrs.language && targetAttrs.language && sourceAttrs.language !== targetAttrs.language) {
      score += 2.0;
      factors.push('cross-language');
    }

    // Factor 3: Cross-community
    if (sourceAttrs.community !== undefined && targetAttrs.community !== undefined &&
        sourceAttrs.community !== targetAttrs.community) {
      score += 1.8;
      factors.push('cross-community');
    }

    // Factor 4: Periphery → hub connection
    const sourceDegree = graph.degree(source);
    const targetDegree = graph.degree(target);
    if (sourceDegree <= 2 && targetDegree >= 15) {
      score += 1.3;
      factors.push('periphery-to-hub');
    }

    // Factor 5: Different file types
    if (sourceAttrs.type && targetAttrs.type && sourceAttrs.type !== targetAttrs.type) {
      const typeJump = `${sourceAttrs.type}→${targetAttrs.type}`;
      if (['module→class', 'function→class'].includes(typeJump)) {
        // Normal, don't score
      } else {
        score += 0.5;
        factors.push('type-mismatch');
      }
    }

    if (score > 0) {
      scored.push({
        source,
        target,
        sourceLabel: sourceAttrs.label || source,
        targetLabel: targetAttrs.label || target,
        relation: attrs.relation,
        confidence: attrs.confidence,
        score,
        factors,
      });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

export function getGraphStats(graph) {
  const nodeTypes = {};
  const edgeTypes = {};
  const languages = {};
  const confidenceCounts = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 };
  let totalDegree = 0;

  graph.forEachNode((id, attrs) => {
    const type = attrs.type || 'unknown';
    nodeTypes[type] = (nodeTypes[type] || 0) + 1;
    const lang = attrs.language || 'unknown';
    languages[lang] = (languages[lang] || 0) + 1;
    totalDegree += graph.degree(id);
  });

  graph.forEachEdge((id, attrs) => {
    const rel = attrs.relation || 'unknown';
    edgeTypes[rel] = (edgeTypes[rel] || 0) + 1;
    const conf = attrs.confidence || 'EXTRACTED';
    if (confidenceCounts[conf] !== undefined) confidenceCounts[conf]++;
  });

  const nodeCount = graph.order;
  const edgeCount = graph.size;

  return {
    nodeCount,
    edgeCount,
    avgDegree: nodeCount > 0 ? Math.round((totalDegree / nodeCount) * 100) / 100 : 0,
    nodeTypes,
    edgeTypes,
    languages,
    confidenceCounts,
  };
}

export function computeBlastRadius(graph, changedFiles) {
  const fileSet = new Set(changedFiles.map(f => f.replace(/\\/g, '/')));
  const affectedNodes = new Set();
  const affectedCommunities = new Set();

  // Find all nodes in changed files
  const seedNodes = [];
  graph.forEachNode((id, attrs) => {
    const file = (attrs.file || '').replace(/\\/g, '/');
    if (fileSet.has(file)) {
      seedNodes.push(id);
      affectedNodes.add(id);
      if (attrs.community !== undefined) affectedCommunities.add(attrs.community);
    }
  });

  // BFS backwards (incoming edges) to find dependents
  const queue = [...seedNodes];
  const visited = new Set(seedNodes);
  const maxDepth = 3;
  const depthMap = new Map(seedNodes.map(n => [n, 0]));

  while (queue.length > 0) {
    const current = queue.shift();
    const currentDepth = depthMap.get(current) || 0;
    if (currentDepth >= maxDepth) continue;

    // Find nodes that point TO current (dependents)
    graph.forEachInEdge(current, (edgeId, attrs, source) => {
      if (!visited.has(source)) {
        visited.add(source);
        affectedNodes.add(source);
        depthMap.set(source, currentDepth + 1);
        queue.push(source);

        const community = graph.getNodeAttribute(source, 'community');
        if (community !== undefined) affectedCommunities.add(community);
      }
    });
  }

  // Calculate risk score
  const totalNodes = graph.order;
  const totalCommunities = new Set();
  graph.forEachNode((id, attrs) => {
    if (attrs.community !== undefined) totalCommunities.add(attrs.community);
  });

  const nodeRatio = totalNodes > 0 ? affectedNodes.size / totalNodes : 0;
  const communityRatio = totalCommunities.size > 0 ? affectedCommunities.size / totalCommunities.size : 0;
  const riskScore = Math.min(100, Math.round((nodeRatio * 50 + communityRatio * 50)));

  return {
    changedFiles: [...fileSet],
    affectedNodes: [...affectedNodes],
    affectedNodeCount: affectedNodes.size,
    affectedCommunities: [...affectedCommunities],
    affectedCommunityCount: affectedCommunities.size,
    riskScore,
    totalNodes,
    totalCommunities: totalCommunities.size,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/analyze.test.js
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/analyze.js tests/code-graph/analyze.test.js
git commit -m "feat(code-graph): add graph analysis (god nodes, surprises, blast radius)

God nodes: detects overly-connected refactoring candidates.
Surprises: scores edges by cross-language, cross-community, ambiguity.
Blast radius: BFS reverse traversal for change impact analysis."
```

---

### Task 9: Query Engine (BFS/DFS, IDF search, token budget)

**Files:**
- Create: `lib/code-graph/query.js`
- Create: `tests/code-graph/query.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/query.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/query.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement query.js**

Create `lib/code-graph/query.js`:

```javascript
import { bidirectional } from 'graphology-shortest-path';

export function queryGraph(graph, queryString, options = {}) {
  const budget = options.budget || 4000;
  const mode = options.mode || 'bfs';
  const maxDepth = options.maxDepth || 2;

  // Phase 1: IDF-weighted seed selection
  const seeds = findSeeds(graph, queryString);

  if (seeds.length === 0) {
    return { nodes: [], edges: [], text: 'No matching nodes found.' };
  }

  // Phase 2: BFS/DFS expansion from seeds
  const subgraph = expandFromSeeds(graph, seeds, { mode, maxDepth });

  // Phase 3: Render to text within token budget
  const text = renderSubgraph(graph, subgraph, budget);

  return {
    nodes: subgraph.nodes.map(id => ({
      id,
      label: graph.getNodeAttribute(id, 'label'),
      type: graph.getNodeAttribute(id, 'type'),
      file: graph.getNodeAttribute(id, 'file'),
      community: graph.getNodeAttribute(id, 'community'),
    })),
    edges: subgraph.edges,
    text,
  };
}

function findSeeds(graph, query) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  // Compute IDF for each term
  const docCount = graph.order;
  const termDocFreq = new Map();
  for (const term of terms) {
    let count = 0;
    graph.forEachNode((id, attrs) => {
      const text = `${attrs.label || ''} ${attrs.type || ''} ${attrs.file || ''}`.toLowerCase();
      if (text.includes(term)) count++;
    });
    termDocFreq.set(term, count);
  }

  // Score each node
  const scored = [];
  graph.forEachNode((id, attrs) => {
    const text = `${attrs.label || ''} ${attrs.type || ''} ${attrs.file || ''}`.toLowerCase();
    let score = 0;

    for (const term of terms) {
      const df = termDocFreq.get(term) || 1;
      const idf = Math.log(1 + docCount / df);

      if (attrs.label && attrs.label.toLowerCase() === term) {
        score += 3 * idf; // Exact label match
      } else if (attrs.label && attrs.label.toLowerCase().startsWith(term)) {
        score += 2 * idf; // Prefix match
      } else if (text.includes(term)) {
        score += 1 * idf; // Substring match
      }
    }

    if (score > 0) {
      scored.push({ id, score });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10).map(s => s.id);
}

function expandFromSeeds(graph, seeds, options) {
  const { mode, maxDepth } = options;
  const visited = new Set();
  const nodes = [];
  const edges = [];

  // Hub threshold: P99 of degree distribution, min 50
  const degrees = [];
  graph.forEachNode((id) => degrees.push(graph.degree(id)));
  degrees.sort((a, b) => a - b);
  const p99Idx = Math.floor(degrees.length * 0.99);
  const hubThreshold = Math.max(degrees[p99Idx] || 50, 50);

  if (mode === 'dfs') {
    for (const seed of seeds) {
      dfs(graph, seed, 0, maxDepth, visited, nodes, edges, hubThreshold);
    }
  } else {
    // BFS (default)
    const queue = seeds.map(s => ({ id: s, depth: 0 }));
    for (const seed of seeds) visited.add(seed);

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      nodes.push(id);

      if (depth >= maxDepth) continue;
      if (graph.degree(id) >= hubThreshold) continue; // Skip hub explosion

      graph.forEachOutEdge(id, (edgeId, attrs, source, target) => {
        edges.push({ source, target, relation: attrs.relation, confidence: attrs.confidence });
        if (!visited.has(target)) {
          visited.add(target);
          queue.push({ id: target, depth: depth + 1 });
        }
      });

      graph.forEachInEdge(id, (edgeId, attrs, source) => {
        edges.push({ source, target: id, relation: attrs.relation, confidence: attrs.confidence });
        if (!visited.has(source)) {
          visited.add(source);
          queue.push({ id: source, depth: depth + 1 });
        }
      });
    }
  }

  return { nodes, edges };
}

function dfs(graph, nodeId, depth, maxDepth, visited, nodes, edges, hubThreshold) {
  if (visited.has(nodeId) || depth > maxDepth) return;
  visited.add(nodeId);
  nodes.push(nodeId);

  if (graph.degree(nodeId) >= hubThreshold) return;

  graph.forEachOutEdge(nodeId, (edgeId, attrs, source, target) => {
    edges.push({ source, target, relation: attrs.relation, confidence: attrs.confidence });
    dfs(graph, target, depth + 1, maxDepth, visited, nodes, edges, hubThreshold);
  });
}

function renderSubgraph(graph, subgraph, budget) {
  const lines = [];
  let charCount = 0;
  const charsPerToken = 4; // Rough estimate
  const charBudget = budget * charsPerToken;

  // Render seed nodes first
  for (const nodeId of subgraph.nodes) {
    const attrs = graph.getNodeAttributes(nodeId);
    const line = `[${attrs.type || '?'}] ${attrs.label || nodeId} (${attrs.file || ''}:${attrs.line || '?'})`;

    if (charCount + line.length > charBudget) break;
    lines.push(line);
    charCount += line.length + 1;
  }

  // Render edges
  for (const edge of subgraph.edges) {
    const line = `  ${edge.source.split('::').pop() || edge.source} --${edge.relation}--> ${edge.target.split('::').pop() || edge.target} [${edge.confidence || '?'}]`;

    if (charCount + line.length > charBudget) break;
    lines.push(line);
    charCount += line.length + 1;
  }

  return lines.join('\n');
}

function tokenize(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

export function findShortestPath(graph, fromId, toId) {
  if (!graph.hasNode(fromId) || !graph.hasNode(toId)) return [];

  try {
    const path = bidirectional(graph, fromId, toId);
    return path || [];
  } catch {
    return [];
  }
}

export function getNeighbors(graph, nodeId, options = {}) {
  if (!graph.hasNode(nodeId)) return [];

  const relation = options.relation || null;
  const neighbors = [];

  graph.forEachOutEdge(nodeId, (edgeId, attrs, source, target) => {
    if (relation && attrs.relation !== relation) return;
    neighbors.push({
      id: target,
      label: graph.getNodeAttribute(target, 'label'),
      type: graph.getNodeAttribute(target, 'type'),
      relation: attrs.relation,
      confidence: attrs.confidence,
      direction: 'outgoing',
    });
  });

  graph.forEachInEdge(nodeId, (edgeId, attrs, source) => {
    if (relation && attrs.relation !== relation) return;
    neighbors.push({
      id: source,
      label: graph.getNodeAttribute(source, 'label'),
      type: graph.getNodeAttribute(source, 'type'),
      relation: attrs.relation,
      confidence: attrs.confidence,
      direction: 'incoming',
    });
  });

  return neighbors;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/query.test.js
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/query.js tests/code-graph/query.test.js
git commit -m "feat(code-graph): add query engine with IDF search and token budgeting

BFS/DFS traversal from IDF-weighted seeds. Hub threshold prevents
explosion. Token-budgeted text rendering. Shortest path via bidirectional BFS."
```

---

### Task 10: Bridge Module (brain-entry ↔ code nodes)

**Files:**
- Create: `lib/code-graph/bridge.js`
- Create: `tests/code-graph/bridge.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/bridge.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/bridge.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement bridge.js**

Create `lib/code-graph/bridge.js`:

```javascript
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class BridgeManager {
  constructor(bridgesPath) {
    this.bridgesPath = bridgesPath;
    this.bridges = null;
  }

  async load() {
    if (this.bridges) return this.bridges;
    try {
      const data = await readFile(this.bridgesPath, 'utf-8');
      this.bridges = JSON.parse(data).bridges || [];
    } catch {
      this.bridges = [];
    }
    return this.bridges;
  }

  async save() {
    await mkdir(dirname(this.bridgesPath), { recursive: true });
    await writeFile(this.bridgesPath, JSON.stringify({ bridges: this.bridges }, null, 2), 'utf-8');
  }

  async addBridge({ brainId, codeNodes, relation, auto = false }) {
    await this.load();

    // Avoid duplicates
    const existing = this.bridges.find(b =>
      b.brainId === brainId && JSON.stringify(b.codeNodes) === JSON.stringify(codeNodes)
    );
    if (existing) return existing;

    const bridge = {
      brainId,
      codeNodes,
      relation: relation || 'relates_to',
      auto,
      created: new Date().toISOString().split('T')[0],
    };

    this.bridges.push(bridge);
    await this.save();
    return bridge;
  }

  async getBridges() {
    return this.load();
  }

  async getBridgesForEntry(brainId) {
    await this.load();
    return this.bridges.filter(b => b.brainId === brainId);
  }

  async getBridgesForCodeNode(codeNodeId) {
    await this.load();
    return this.bridges.filter(b => b.codeNodes.includes(codeNodeId));
  }

  async autoDetect(graph, brainEntries) {
    await this.load();
    const newBridges = [];

    // Build file → code nodes map
    const fileToNodes = new Map();
    graph.forEachNode((id, attrs) => {
      const file = (attrs.file || '').replace(/\\/g, '/');
      if (!file || attrs.type === 'module') return; // Skip module nodes, only link actual code entities
      if (!fileToNodes.has(file)) fileToNodes.set(file, []);
      fileToNodes.get(file).push(id);
    });

    for (const entry of brainEntries) {
      if (!entry.files || entry.files.length === 0) continue;

      const matchedCodeNodes = [];
      for (const entryFile of entry.files) {
        const normalized = entryFile.replace(/\\/g, '/');
        const codeNodes = fileToNodes.get(normalized) || [];
        matchedCodeNodes.push(...codeNodes);
      }

      if (matchedCodeNodes.length === 0) continue;

      // Check if bridge already exists
      const existing = this.bridges.find(b => b.brainId === entry.id && b.auto);
      if (existing) continue;

      const bridge = {
        brainId: entry.id,
        codeNodes: matchedCodeNodes,
        relation: 'affects',
        auto: true,
        created: new Date().toISOString().split('T')[0],
      };

      this.bridges.push(bridge);
      newBridges.push(bridge);
    }

    if (newBridges.length > 0) {
      await this.save();
    }

    return newBridges;
  }

  async removeBridgesForEntry(brainId) {
    await this.load();
    this.bridges = this.bridges.filter(b => b.brainId !== brainId);
    await this.save();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/bridge.test.js
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/bridge.js tests/code-graph/bridge.test.js
git commit -m "feat(code-graph): add bridge module linking brain entries to code nodes

Manual and automatic bridge creation. Auto-detect matches brain
entry files to code graph nodes. Bidirectional lookup."
```

---

### Task 11: CodeGraph Orchestrator (full pipeline)

**Files:**
- Modify: `lib/code-graph/index.js`
- Create: `tests/code-graph/index.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/index.test.js`:

```javascript
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
    assert.ok(result.communityCount >= 0, 'should detect communities');
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
    assert.ok(stats.edgeCount >= 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/index.test.js
```

Expected: FAIL — CodeGraph doesn't have build/save/load/query methods yet

- [ ] **Step 3: Implement the full orchestrator**

Update `lib/code-graph/index.js`:

```javascript
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { scanFiles } from './scan.js';
import { extractFromFile, extractFromSource } from './extract.js';
import { buildGraph, resolveReferences, graphToJSON, graphFromJSON } from './build.js';
import { detectCommunities, getCommunityStats } from './cluster.js';
import { findGodNodes, findSurprises, getGraphStats, computeBlastRadius } from './analyze.js';
import { queryGraph, findShortestPath, getNeighbors } from './query.js';
import { ASTCache } from './cache.js';
import { BridgeManager } from './bridge.js';

export class CodeGraph {
  constructor(projectPath, brainPath) {
    this.projectPath = projectPath;
    this.brainPath = brainPath;
    this.codeGraphPath = join(brainPath, 'code-graph');
    this.graphPath = join(this.codeGraphPath, 'graph.json');
    this.communitiesPath = join(this.codeGraphPath, 'communities.json');
    this.analysisPath = join(this.codeGraphPath, 'analysis.json');
    this.cachePath = join(this.codeGraphPath, 'cache', 'ast');
    this.cache = new ASTCache(this.cachePath);
    this.bridge = new BridgeManager(join(this.codeGraphPath, 'bridges.json'));
    this.graph = null;
    this._communities = null;
    this._analysis = null;
  }

  async ensureDirs() {
    await mkdir(this.cachePath, { recursive: true });
  }

  async build(options = {}) {
    await this.ensureDirs();
    const mode = options.mode || 'full';

    // Phase 1: Scan files
    const files = await scanFiles(this.projectPath);

    // Phase 2: Extract AST from each file
    const extractions = [];
    for (const file of files) {
      try {
        const content = await readFile(file.absolutePath, 'utf-8');
        const extraction = await this.cache.getOrExtract(
          file.absolutePath,
          content,
          () => extractFromSource(content, file.relativePath, file.language)
        );
        extractions.push(extraction);
      } catch (err) {
        process.stderr.write(`[code-graph] Warning: Failed to extract ${file.relativePath}: ${err.message}\n`);
      }
    }

    // Phase 3: Build graph
    this.graph = buildGraph(extractions);
    resolveReferences(this.graph);

    // Phase 4: Community detection
    let communityResult = { count: 0, modularity: 0 };
    if (this.graph.order >= 3) {
      try {
        communityResult = detectCommunities(this.graph);
      } catch (err) {
        process.stderr.write(`[code-graph] Warning: Community detection failed: ${err.message}\n`);
      }
    }
    this._communities = getCommunityStats(this.graph);

    // Phase 5: Analysis
    this._analysis = {
      godNodes: findGodNodes(this.graph),
      surprises: findSurprises(this.graph),
      stats: getGraphStats(this.graph),
    };

    // Phase 6: Save
    await this.save();

    return {
      nodeCount: this.graph.order,
      edgeCount: this.graph.size,
      communityCount: communityResult.count,
      modularity: communityResult.modularity,
      godNodeCount: this._analysis.godNodes.length,
      surpriseCount: this._analysis.surprises.length,
      fileCount: files.length,
    };
  }

  async save() {
    if (!this.graph) return;
    await this.ensureDirs();

    const graphData = graphToJSON(this.graph);
    await writeFile(this.graphPath, JSON.stringify(graphData), 'utf-8');

    if (this._communities) {
      await writeFile(this.communitiesPath, JSON.stringify(this._communities, null, 2), 'utf-8');
    }
    if (this._analysis) {
      await writeFile(this.analysisPath, JSON.stringify(this._analysis, null, 2), 'utf-8');
    }
  }

  async load() {
    if (!existsSync(this.graphPath)) return false;

    try {
      const data = JSON.parse(await readFile(this.graphPath, 'utf-8'));
      this.graph = graphFromJSON(data);

      if (existsSync(this.communitiesPath)) {
        this._communities = JSON.parse(await readFile(this.communitiesPath, 'utf-8'));
      }
      if (existsSync(this.analysisPath)) {
        this._analysis = JSON.parse(await readFile(this.analysisPath, 'utf-8'));
      }
      return true;
    } catch (err) {
      process.stderr.write(`[code-graph] Warning: Failed to load graph: ${err.message}\n`);
      return false;
    }
  }

  async ensureLoaded() {
    if (!this.graph) {
      const loaded = await this.load();
      if (!loaded) {
        throw new Error('Code graph not built yet. Run brain_code_build first.');
      }
    }
  }

  query(queryString, options = {}) {
    if (!this.graph) throw new Error('Graph not loaded');
    return queryGraph(this.graph, queryString, options);
  }

  shortestPath(fromId, toId) {
    if (!this.graph) throw new Error('Graph not loaded');
    return findShortestPath(this.graph, fromId, toId);
  }

  neighbors(nodeId, options = {}) {
    if (!this.graph) throw new Error('Graph not loaded');
    return getNeighbors(this.graph, nodeId, options);
  }

  getNode(nodeId) {
    if (!this.graph || !this.graph.hasNode(nodeId)) return null;
    return {
      id: nodeId,
      ...this.graph.getNodeAttributes(nodeId),
      degree: this.graph.degree(nodeId),
      inDegree: this.graph.inDegree(nodeId),
      outDegree: this.graph.outDegree(nodeId),
    };
  }

  getStats() {
    if (!this.graph) throw new Error('Graph not loaded');
    return getGraphStats(this.graph);
  }

  getCommunities() {
    if (!this._communities) throw new Error('Communities not computed');
    return this._communities;
  }

  getCommunity(communityId) {
    if (!this._communities) throw new Error('Communities not computed');
    return this._communities.communities.find(c => c.id === communityId) || null;
  }

  getGodNodes() {
    if (!this._analysis) return [];
    return this._analysis.godNodes;
  }

  getSurprises() {
    if (!this._analysis) return [];
    return this._analysis.surprises;
  }

  blastRadius(changedFiles) {
    if (!this.graph) throw new Error('Graph not loaded');
    return computeBlastRadius(this.graph, changedFiles);
  }

  async autoBridge(brainEntries) {
    if (!this.graph) throw new Error('Graph not loaded');
    return this.bridge.autoDetect(this.graph, brainEntries);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/index.test.js
```

Expected: All 4 tests PASS (requires WASM files from Task 4)

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/index.js tests/code-graph/index.test.js
git commit -m "feat(code-graph): wire full pipeline in CodeGraph orchestrator

scan → extract → build → cluster → analyze, with save/load,
query, path-finding, blast radius, and bridge auto-detection."
```

---

### Task 12: MCP Handler + Tool Registration

**Files:**
- Create: `lib/handlers/code-graph.js`
- Modify: `lib/handlers/index.js`
- Modify: `mcp-server.js`

- [ ] **Step 1: Create the MCP handler**

Create `lib/handlers/code-graph.js`:

```javascript
import { CodeGraph } from '../code-graph/index.js';

let codeGraphInstance = null;

function getCodeGraph(ctx) {
  if (!codeGraphInstance) {
    codeGraphInstance = new CodeGraph(ctx.manager.projectPath, ctx.manager.brainPath);
  }
  return codeGraphInstance;
}

export const codeGraphHandlers = {
  brain_code_build: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      const result = await cg.build({ mode: args.mode || 'full' });

      // Auto-bridge with brain entries
      try {
        const index = await ctx.manager.loadIndex();
        await cg.autoBridge(index.entries);
      } catch { }

      return [{
        type: 'text',
        text: `Code graph built: ${result.nodeCount} nodes, ${result.edgeCount} edges, ${result.communityCount} communities.\n` +
          `Files scanned: ${result.fileCount}\n` +
          `God nodes: ${result.godNodeCount}\n` +
          `Surprising connections: ${result.surpriseCount}\n` +
          `Modularity: ${result.modularity.toFixed(3)}`,
      }];
    } catch (err) {
      return [{ type: 'text', text: `Error building code graph: ${err.message}` }];
    }
  },

  brain_code_query: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const result = cg.query(args.query, {
        budget: args.budget || 4000,
        mode: args.mode || 'bfs',
        maxDepth: args.max_depth || 2,
      });
      return [{ type: 'text', text: result.text || 'No results found.' }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_node: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const node = cg.getNode(args.node_id);
      if (!node) return [{ type: 'text', text: `Node not found: ${args.node_id}` }];

      const neighbors = cg.neighbors(args.node_id);
      const bridgeEntries = await cg.bridge.getBridgesForCodeNode(args.node_id);

      let text = `Node: ${node.label} (${node.type})\n`;
      text += `File: ${node.file}:${node.line}\n`;
      text += `Language: ${node.language}\n`;
      text += `Community: ${node.community}\n`;
      text += `Degree: ${node.degree} (in: ${node.inDegree}, out: ${node.outDegree})\n`;

      if (neighbors.length > 0) {
        text += `\nNeighbors (${neighbors.length}):\n`;
        for (const n of neighbors.slice(0, 20)) {
          text += `  ${n.direction === 'outgoing' ? '→' : '←'} ${n.label} (${n.relation}) [${n.confidence}]\n`;
        }
      }

      if (bridgeEntries.length > 0) {
        text += `\nBrain entries:\n`;
        for (const b of bridgeEntries) {
          text += `  ${b.brainId} (${b.relation})\n`;
        }
      }

      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_neighbors: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const neighbors = cg.neighbors(args.node_id, { relation: args.relation });

      if (neighbors.length === 0) {
        return [{ type: 'text', text: `No neighbors found for: ${args.node_id}` }];
      }

      let text = `Neighbors of ${args.node_id} (${neighbors.length}):\n`;
      for (const n of neighbors) {
        text += `  ${n.direction === 'outgoing' ? '→' : '←'} [${n.type}] ${n.label} --${n.relation}--> [${n.confidence}]\n`;
      }
      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_path: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const path = cg.shortestPath(args.from, args.to);

      if (path.length === 0) {
        return [{ type: 'text', text: `No path found between ${args.from} and ${args.to}` }];
      }

      let text = `Shortest path (${path.length} nodes):\n`;
      for (let i = 0; i < path.length; i++) {
        const node = cg.getNode(path[i]);
        text += `  ${i + 1}. [${node?.type || '?'}] ${node?.label || path[i]}`;
        if (i < path.length - 1) text += ' →';
        text += '\n';
      }
      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_community: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const community = cg.getCommunity(args.community_id);

      if (!community) {
        return [{ type: 'text', text: `Community not found: ${args.community_id}` }];
      }

      let text = `Community ${community.id} (${community.size} nodes):\n`;
      text += `Files: ${community.files.join(', ')}\n`;
      text += `Types: ${JSON.stringify(community.types)}\n\n`;
      text += `Nodes:\n`;
      for (const nodeId of community.nodes.slice(0, 30)) {
        const node = cg.getNode(nodeId);
        text += `  [${node?.type || '?'}] ${node?.label || nodeId} (${node?.file || ''})\n`;
      }
      if (community.nodes.length > 30) {
        text += `  ... and ${community.nodes.length - 30} more\n`;
      }
      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_stats: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const stats = cg.getStats();
      const communities = cg.getCommunities();

      let text = `Code Graph Statistics:\n`;
      text += `  Nodes: ${stats.nodeCount}\n`;
      text += `  Edges: ${stats.edgeCount}\n`;
      text += `  Avg degree: ${stats.avgDegree}\n`;
      text += `  Communities: ${communities.totalCommunities}\n\n`;
      text += `Node types: ${JSON.stringify(stats.nodeTypes)}\n`;
      text += `Edge types: ${JSON.stringify(stats.edgeTypes)}\n`;
      text += `Languages: ${JSON.stringify(stats.languages)}\n`;
      text += `Confidence: ${JSON.stringify(stats.confidenceCounts)}\n`;

      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_blast: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const result = cg.blastRadius(args.files);

      let text = `Blast Radius Analysis:\n`;
      text += `  Changed files: ${result.changedFiles.join(', ')}\n`;
      text += `  Affected nodes: ${result.affectedNodeCount} / ${result.totalNodes}\n`;
      text += `  Affected communities: ${result.affectedCommunityCount} / ${result.totalCommunities}\n`;
      text += `  Risk score: ${result.riskScore}/100\n`;

      if (result.affectedNodeCount > 0) {
        text += `\nAffected nodes (first 20):\n`;
        for (const nodeId of result.affectedNodes.slice(0, 20)) {
          const node = cg.getNode(nodeId);
          text += `  [${node?.type || '?'}] ${node?.label || nodeId}\n`;
        }
      }

      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_gods: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const gods = cg.getGodNodes();

      if (gods.length === 0) {
        return [{ type: 'text', text: 'No god nodes found (all nodes have reasonable connectivity).' }];
      }

      let text = `God Nodes (${gods.length} overly-connected nodes):\n`;
      for (const g of gods) {
        text += `  [${g.type}] ${g.label} — degree: ${g.degree} (in: ${g.inDegree}, out: ${g.outDegree}) — ${g.file}\n`;
      }
      text += `\nThese are refactoring candidates — consider splitting responsibilities.`;

      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_surprises: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const surprises = cg.getSurprises();

      if (surprises.length === 0) {
        return [{ type: 'text', text: 'No surprising connections found.' }];
      }

      let text = `Surprising Connections (${surprises.length}):\n`;
      for (const s of surprises) {
        text += `  ${s.sourceLabel} --${s.relation}--> ${s.targetLabel} [score: ${s.score.toFixed(1)}]\n`;
        text += `    Factors: ${s.factors.join(', ')}\n`;
      }

      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_code_health: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const stats = cg.getStats();
      const gods = cg.getGodNodes();
      const surprises = cg.getSurprises();

      // Check orphan nodes (degree 0)
      let orphanCount = 0;
      cg.graph.forEachNode((id) => {
        if (cg.graph.degree(id) === 0) orphanCount++;
      });

      // Check ambiguous edges
      const ambiguousCount = stats.confidenceCounts.AMBIGUOUS || 0;

      let text = `Code Graph Health Report:\n`;
      text += `  Nodes: ${stats.nodeCount}, Edges: ${stats.edgeCount}\n`;
      text += `  Orphan nodes: ${orphanCount}\n`;
      text += `  God nodes: ${gods.length}\n`;
      text += `  Ambiguous edges: ${ambiguousCount}\n`;
      text += `  Surprising connections: ${surprises.length}\n\n`;

      if (orphanCount > 0) text += `⚠ ${orphanCount} orphan nodes with no connections\n`;
      if (gods.length > 0) text += `⚠ ${gods.length} god nodes need refactoring attention\n`;
      if (ambiguousCount > 0) text += `⚠ ${ambiguousCount} ambiguous edges need review\n`;
      if (orphanCount === 0 && gods.length === 0 && ambiguousCount === 0) {
        text += `✓ Code graph is healthy`;
      }

      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_bridge: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const bridge = await cg.bridge.addBridge({
        brainId: args.brain_id,
        codeNodes: args.code_nodes,
        relation: args.relation || 'relates_to',
        auto: false,
      });

      return [{ type: 'text', text: `Bridge created: ${bridge.brainId} → ${bridge.codeNodes.join(', ')} (${bridge.relation})` }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },

  brain_bridge_auto: async (ctx, args) => {
    const cg = getCodeGraph(ctx);
    try {
      await cg.ensureLoaded();
      const index = await ctx.manager.loadIndex();
      const newBridges = await cg.autoBridge(index.entries);

      if (newBridges.length === 0) {
        return [{ type: 'text', text: 'No new bridges detected (all existing matches already bridged).' }];
      }

      let text = `Auto-detected ${newBridges.length} new bridges:\n`;
      for (const b of newBridges) {
        text += `  ${b.brainId} → ${b.codeNodes.length} code nodes (${b.relation})\n`;
      }
      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error: ${err.message}` }];
    }
  },
};
```

- [ ] **Step 2: Register handler in handlers/index.js**

Add to `lib/handlers/index.js`:

```javascript
import { codeGraphHandlers } from './code-graph.js';
```

And add `...codeGraphHandlers,` to the HANDLERS export object.

- [ ] **Step 3: Add tool definitions to mcp-server.js**

Add the following tool definitions to the `TOOLS` array in `mcp-server.js` (after the existing tool definitions):

```javascript
// === CODE GRAPH TOOLS ===
{
  name: 'brain_code_build',
  description: 'Build or rebuild the code graph from project source files using tree-sitter AST parsing',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['full', 'incremental'], description: 'Build mode (default: full)' },
    },
  },
},
{
  name: 'brain_code_query',
  description: 'Query the code graph with natural language. Returns relevant code nodes and relationships within a token budget.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language query about the code' },
      budget: { type: 'number', description: 'Token budget for response (default: 4000)' },
      mode: { type: 'string', enum: ['bfs', 'dfs'], description: 'Traversal mode (default: bfs)' },
      max_depth: { type: 'number', description: 'Max traversal depth (default: 2)' },
    },
    required: ['query'],
  },
},
{
  name: 'brain_code_node',
  description: 'Get details of a single code node (metadata, neighbors, brain entry links)',
  inputSchema: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'Node ID (e.g., "src/auth.js::login")' },
    },
    required: ['node_id'],
  },
},
{
  name: 'brain_code_neighbors',
  description: 'List neighbors of a code node with optional relation type filter',
  inputSchema: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'Node ID' },
      relation: { type: 'string', description: 'Filter by relation type (calls, imports, inherits, etc.)' },
    },
    required: ['node_id'],
  },
},
{
  name: 'brain_code_path',
  description: 'Find shortest path between two code nodes',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source node ID' },
      to: { type: 'string', description: 'Target node ID' },
    },
    required: ['from', 'to'],
  },
},
{
  name: 'brain_code_community',
  description: 'List all nodes in a community (logical code cluster)',
  inputSchema: {
    type: 'object',
    properties: {
      community_id: { type: 'number', description: 'Community ID' },
    },
    required: ['community_id'],
  },
},
{
  name: 'brain_code_stats',
  description: 'Get code graph statistics (nodes, edges, communities, languages, confidence)',
  inputSchema: { type: 'object', properties: {} },
},
{
  name: 'brain_code_blast',
  description: 'Calculate blast radius for changed files (how many nodes and communities are affected)',
  inputSchema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'List of changed file paths' },
    },
    required: ['files'],
  },
},
{
  name: 'brain_code_gods',
  description: 'List god nodes (overly-connected refactoring candidates)',
  inputSchema: { type: 'object', properties: {} },
},
{
  name: 'brain_code_surprises',
  description: 'List surprising connections (cross-language, cross-community, ambiguous)',
  inputSchema: { type: 'object', properties: {} },
},
{
  name: 'brain_code_health',
  description: 'Code graph health report (orphans, god nodes, ambiguous edges)',
  inputSchema: { type: 'object', properties: {} },
},
{
  name: 'brain_bridge',
  description: 'Manually link a brain entry to code graph nodes',
  inputSchema: {
    type: 'object',
    properties: {
      brain_id: { type: 'string', description: 'Brain entry ID (e.g., DEC-001)' },
      code_nodes: { type: 'array', items: { type: 'string' }, description: 'Code node IDs to link' },
      relation: { type: 'string', description: 'Relation type (documents, implements, affects)' },
    },
    required: ['brain_id', 'code_nodes'],
  },
},
{
  name: 'brain_bridge_auto',
  description: 'Auto-detect bridges between brain entries and code nodes based on file paths',
  inputSchema: { type: 'object', properties: {} },
},
```

- [ ] **Step 4: Run existing tests to verify no regressions**

```bash
node --test tests/handlers.test.js
```

Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/handlers/code-graph.js lib/handlers/index.js mcp-server.js
git commit -m "feat(code-graph): register 13 MCP tools for code graph

brain_code_build, brain_code_query, brain_code_node, brain_code_neighbors,
brain_code_path, brain_code_community, brain_code_stats, brain_code_blast,
brain_code_gods, brain_code_surprises, brain_code_health, brain_bridge,
brain_bridge_auto. Total tools: 52."
```

---

## End of Part 2

### Summary of all tasks

| Task | Component | Status |
|------|-----------|--------|
| 1 | Dependencies + directory structure | Part 1 |
| 2 | File scanner | Part 1 |
| 3 | Language configs (JS/TS/Python) | Part 1 |
| 4 | AST extractor (tree-sitter) | Part 1 |
| 5 | AST cache (SHA256 + stat) | Part 1 |
| 6 | Graph builder (graphology) | Part 1 |
| 7 | Community detection (Louvain) | Part 2 |
| 8 | Analysis (god nodes, surprises, blast radius) | Part 2 |
| 9 | Query engine (BFS/DFS, IDF, token budget) | Part 2 |
| 10 | Bridge module (brain ↔ code) | Part 2 |
| 11 | CodeGraph orchestrator | Part 2 |
| 12 | MCP handler + tool registration | Part 2 |

### Future tasks (not in this plan)

- Additional language configs (Go, Rust, Java, C, C++, Ruby, C#, Kotlin, PHP)
- brain_preflight integration (code graph risk scoring)
- Git hooks for auto-rebuild
- Visualization (D3.js / vis.js)
- Cross-file call resolution (import-guided)
- GRAPH_REPORT.md generation
- Incremental update mode
