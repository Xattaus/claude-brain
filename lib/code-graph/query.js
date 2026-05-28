import { bidirectional } from 'graphology-shortest-path';

// ---------- Tokenization helpers ----------

/**
 * Tokenize a string into lowercase alphanumeric tokens.
 */
function tokenize(str) {
  return str
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// ---------- IDF scoring ----------

/**
 * Compute inverse-document-frequency weights for each query term over the
 * graph's node labels, types, and file paths.
 *
 * IDF(t) = log((N + 1) / (df(t) + 1)) + 1   (smoothed)
 *
 * Returns a Map<term, idfScore>.
 */
function computeIDF(graph, queryTerms) {
  const N = graph.order; // total number of nodes
  const df = new Map(); // term -> document frequency

  graph.forEachNode((id, attrs) => {
    // Build a "document" from all text attributes of the node
    const doc = [
      attrs.label || '',
      attrs.type || '',
      attrs.file || '',
      id,
    ]
      .join(' ')
      .toLowerCase();

    const docTokens = new Set(tokenize(doc));

    for (const term of queryTerms) {
      if (docTokens.has(term)) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }
  });

  const idf = new Map();
  for (const term of queryTerms) {
    const docFreq = df.get(term) || 0;
    idf.set(term, Math.log((N + 1) / (docFreq + 1)) + 1);
  }
  return idf;
}

/**
 * Score a single node against the query terms using IDF weights.
 *
 * Match types (descending priority):
 *   exact  (term === token) : weight * 3
 *   prefix (token.startsWith(term)) : weight * 2
 *   substring (token.includes(term)) : weight * 1
 */
function scoreNode(nodeId, attrs, queryTerms, idf) {
  const textParts = [
    attrs.label || '',
    attrs.type || '',
    attrs.file || '',
    nodeId,
  ].join(' ');

  const nodeTokens = tokenize(textParts);
  let score = 0;

  for (const term of queryTerms) {
    const weight = idf.get(term) || 1;
    for (const token of nodeTokens) {
      if (token === term) {
        score += weight * 3;
      } else if (token.startsWith(term)) {
        score += weight * 2;
      } else if (token.includes(term)) {
        score += weight * 1;
      }
    }
  }

  return score;
}

// ---------- BFS expansion ----------

/**
 * Compute the P99 out-degree across all nodes as the hub threshold.
 * Nodes whose degree exceeds this threshold are considered hubs and are
 * NOT expanded during BFS (their identity is included but traversal stops).
 * The minimum threshold is 50 to avoid false positives in small graphs.
 */
function computeHubThreshold(graph) {
  const degrees = [];
  graph.forEachNode((id) => {
    degrees.push(graph.degree(id));
  });
  if (degrees.length === 0) return 50;
  degrees.sort((a, b) => a - b);
  const p99idx = Math.floor(degrees.length * 0.99);
  return Math.max(50, degrees[p99idx] ?? degrees[degrees.length - 1]);
}

/**
 * Expand a set of seed node IDs via BFS up to `maxDepth` hops.
 * Hub nodes are not expanded (prevents explosion).
 *
 * Returns a Set of visited node IDs.
 */
function bfsExpand(graph, seeds, maxDepth, hubThreshold) {
  const visited = new Set(seeds);
  let frontier = [...seeds];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier = [];
    for (const nodeId of frontier) {
      // Skip expanding hubs
      if (graph.degree(nodeId) > hubThreshold) continue;

      graph.forEachOutEdge(nodeId, (edgeId, attrs, source, target) => {
        if (!visited.has(target)) {
          visited.add(target);
          nextFrontier.push(target);
        }
      });

      graph.forEachInEdge(nodeId, (edgeId, attrs, source, target) => {
        if (!visited.has(source)) {
          visited.add(source);
          nextFrontier.push(source);
        }
      });
    }
    frontier = nextFrontier;
  }

  return visited;
}

// ---------- Text rendering ----------

/**
 * Estimate tokens from a string (4 chars ~ 1 token).
 */
function estimateTokens(str) {
  return Math.ceil(str.length / 4);
}

/**
 * Render the subgraph (nodes + edges between them) as a compact text
 * representation. Stops adding entries once the token budget is reached.
 *
 * Format:
 *   [type] label  (file)
 *     -> relation -> targetLabel
 *
 * Returns the rendered string.
 */
function renderSubgraph(graph, nodeIds, budget) {
  const nodeSet = new Set(nodeIds);
  const lines = [];
  let usedTokens = 0;
  const tokenBudget = budget ?? Infinity;

  // Sort nodes: modules first, then by label for determinism
  const sorted = [...nodeIds].sort((a, b) => {
    const ta = graph.getNodeAttribute(a, 'type') || '';
    const tb = graph.getNodeAttribute(b, 'type') || '';
    if (ta === 'module' && tb !== 'module') return -1;
    if (tb === 'module' && ta !== 'module') return 1;
    return a.localeCompare(b);
  });

  for (const nodeId of sorted) {
    const attrs = graph.getNodeAttribute(nodeId, 'label')
      ? graph.getNodeAttributes(nodeId)
      : { label: nodeId, type: 'unknown' };

    const nodeLine = `[${attrs.type || 'unknown'}] ${attrs.label || nodeId}  (${attrs.file || nodeId})`;
    const nodeTokens = estimateTokens(nodeLine);

    if (usedTokens + nodeTokens > tokenBudget) break;
    lines.push(nodeLine);
    usedTokens += nodeTokens;

    // Outgoing edges to nodes within the subgraph
    graph.forEachOutEdge(nodeId, (edgeId, edgeAttrs, source, target) => {
      if (!nodeSet.has(target)) return;
      const targetLabel = graph.getNodeAttribute(target, 'label') || target;
      const edgeLine = `  -> ${edgeAttrs.relation || 'related'} -> ${targetLabel}`;
      const edgeTokens = estimateTokens(edgeLine);
      if (usedTokens + edgeTokens <= tokenBudget) {
        lines.push(edgeLine);
        usedTokens += edgeTokens;
      }
    });
  }

  return lines.join('\n');
}

// ---------- Public API ----------

/**
 * Query the graph for nodes relevant to the given query string.
 *
 * Phases:
 *   1. IDF-weighted seed selection — tokenize query, score every node, pick top seeds
 *   2. BFS expansion from seeds (hub-safe)
 *   3. Token-budgeted text rendering
 *
 * @param {import('graphology').default} graph
 * @param {string} queryString
 * @param {{ budget?: number, maxSeeds?: number, maxDepth?: number }} options
 * @returns {{ nodes: object[], edges: object[], text: string }}
 */
export function queryGraph(graph, queryString, options = {}) {
  const {
    budget = 2000,
    maxSeeds = 10,
    maxDepth = 2,
  } = options;

  if (graph.order === 0) {
    return { nodes: [], edges: [], text: '' };
  }

  // Phase 1: IDF-weighted scoring
  const queryTerms = tokenize(queryString);
  if (queryTerms.length === 0) {
    return { nodes: [], edges: [], text: '' };
  }

  const idf = computeIDF(graph, queryTerms);

  const scored = [];
  graph.forEachNode((id, attrs) => {
    const score = scoreNode(id, attrs, queryTerms, idf);
    if (score > 0) {
      scored.push({ id, score, attrs });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  const seeds = scored.slice(0, maxSeeds).map((s) => s.id);

  if (seeds.length === 0) {
    return { nodes: [], edges: [], text: '' };
  }

  // Phase 2: BFS expansion
  const hubThreshold = computeHubThreshold(graph);
  const visitedIds = bfsExpand(graph, seeds, maxDepth, hubThreshold);

  // Collect node objects
  const nodes = [];
  for (const id of visitedIds) {
    nodes.push({ id, ...graph.getNodeAttributes(id) });
  }

  // Collect edges within the subgraph
  const visitedSet = visitedIds;
  const edges = [];
  for (const id of visitedIds) {
    graph.forEachOutEdge(id, (edgeId, attrs, source, target) => {
      if (visitedSet.has(target)) {
        edges.push({ id: edgeId, source, target, ...attrs });
      }
    });
  }

  // Phase 3: Text rendering within token budget
  const text = renderSubgraph(graph, visitedIds, budget);

  return { nodes, edges, text };
}

/**
 * Find the shortest directed path between two nodes using bidirectional BFS.
 *
 * @param {import('graphology').default} graph
 * @param {string} fromId
 * @param {string} toId
 * @returns {string[]} Array of node IDs representing the path, or [] if unreachable.
 */
export function findShortestPath(graph, fromId, toId) {
  try {
    const path = bidirectional(graph, fromId, toId);
    return path ?? [];
  } catch {
    return [];
  }
}

/**
 * Return all neighbors (in- and out-edges) of a node, with optional relation filter.
 *
 * @param {import('graphology').default} graph
 * @param {string} nodeId
 * @param {{ relation?: string }} options
 * @returns {Array<{ id: string, label: string, type: string, relation: string, confidence: string, direction: 'outgoing'|'incoming' }>}
 */
export function getNeighbors(graph, nodeId, options = {}) {
  const { relation: filterRelation } = options;
  const results = [];

  graph.forEachOutEdge(nodeId, (edgeId, attrs, source, target) => {
    if (filterRelation && attrs.relation !== filterRelation) return;
    const targetAttrs = graph.getNodeAttributes(target);
    results.push({
      id: target,
      label: targetAttrs.label || target,
      type: targetAttrs.type || 'unknown',
      relation: attrs.relation || 'unknown',
      confidence: attrs.confidence || 'unknown',
      direction: 'outgoing',
    });
  });

  graph.forEachInEdge(nodeId, (edgeId, attrs, source, target) => {
    if (filterRelation && attrs.relation !== filterRelation) return;
    const sourceAttrs = graph.getNodeAttributes(source);
    results.push({
      id: source,
      label: sourceAttrs.label || source,
      type: sourceAttrs.type || 'unknown',
      relation: attrs.relation || 'unknown',
      confidence: attrs.confidence || 'unknown',
      direction: 'incoming',
    });
  });

  return results;
}
