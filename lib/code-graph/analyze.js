/**
 * Graph analysis: god nodes, surprises, stats, blast radius.
 */

/**
 * Compute the degree (in + out) for every node and return
 * nodes whose degree exceeds the given threshold.
 *
 * @param {import('graphology').default} graph
 * @param {{ minDegree?: number }} options
 *   minDegree — explicit floor; when omitted the threshold is
 *               max(50, P99 of the degree distribution).
 * @returns {{ id, label, type, file, degree, inDegree, outDegree }[]}
 *   Sorted descending by degree.
 */
export function findGodNodes(graph, options = {}) {
  const degrees = [];
  graph.forEachNode((id) => {
    degrees.push(graph.degree(id));
  });

  let threshold;
  if (options.minDegree !== undefined) {
    threshold = options.minDegree;
  } else {
    // P99 of degree distribution, minimum 50
    const sorted = [...degrees].sort((a, b) => a - b);
    const p99idx = Math.floor(sorted.length * 0.99);
    threshold = Math.max(50, sorted[p99idx] ?? 0);
  }

  const results = [];
  graph.forEachNode((id, attrs) => {
    const inDegree = graph.inDegree(id);
    const outDegree = graph.outDegree(id);
    const degree = inDegree + outDegree;
    if (degree >= threshold) {
      results.push({
        id,
        label: attrs.label ?? id,
        type: attrs.type ?? 'unknown',
        file: attrs.file ?? null,
        degree,
        inDegree,
        outDegree,
      });
    }
  });

  results.sort((a, b) => b.degree - a.degree);
  return results;
}

/**
 * Score every edge by "surprise" factors and return the top 20.
 *
 * Factors and their additive scores:
 *   AMBIGUOUS confidence  +2.0
 *   cross-language        +2.0
 *   cross-community       +1.8
 *   periphery→hub         +1.3  (source degree <=2, target degree >=15)
 *   type mismatch         +0.5  (non-standard source/target type combo)
 *
 * @param {import('graphology').default} graph
 * @param {{ topN?: number }} options
 * @returns {{ edge, source, target, score, factors }[]}
 */
export function findSurprises(graph, options = {}) {
  const topN = options.topN ?? 20;

  // Standard type pairs (not surprising)
  const standardPairs = new Set([
    'function-function',
    'function-class',
    'class-class',
    'class-function',
    'method-method',
    'method-function',
    'function-method',
  ]);

  const results = [];

  graph.forEachEdge((edge, attrs, sourceId, targetId, sourceAttrs, targetAttrs) => {
    const factors = [];
    let score = 0;

    // AMBIGUOUS confidence
    if (attrs.confidence === 'AMBIGUOUS') {
      score += 2.0;
      factors.push('ambiguous-confidence');
    }

    // Cross-language
    const srcLang = sourceAttrs.language;
    const tgtLang = targetAttrs.language;
    if (srcLang && tgtLang && srcLang !== tgtLang) {
      score += 2.0;
      factors.push('cross-language');
    }

    // Cross-community
    const srcCom = sourceAttrs.community;
    const tgtCom = targetAttrs.community;
    if (srcCom !== undefined && tgtCom !== undefined && srcCom !== tgtCom) {
      score += 1.8;
      factors.push('cross-community');
    }

    // Periphery → hub
    const srcDegree = graph.degree(sourceId);
    const tgtDegree = graph.degree(targetId);
    if (srcDegree <= 2 && tgtDegree >= 15) {
      score += 1.3;
      factors.push('periphery-to-hub');
    }

    // Type mismatch (non-standard pair)
    const srcType = sourceAttrs.type ?? 'unknown';
    const tgtType = targetAttrs.type ?? 'unknown';
    const pair = `${srcType}-${tgtType}`;
    if (!standardPairs.has(pair)) {
      score += 0.5;
      factors.push('type-mismatch');
    }

    if (score > 0) {
      results.push({
        edge,
        source: sourceId,
        target: targetId,
        score,
        factors,
        relation: attrs.relation ?? null,
        confidence: attrs.confidence ?? null,
      });
    }
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

/**
 * Aggregate statistics for the whole graph.
 *
 * @param {import('graphology').default} graph
 * @returns {{
 *   nodeCount: number,
 *   edgeCount: number,
 *   avgDegree: number,
 *   nodeTypes: Record<string,number>,
 *   edgeTypes: Record<string,number>,
 *   languages: Record<string,number>,
 *   confidenceCounts: Record<string,number>
 * }}
 */
export function getGraphStats(graph) {
  const nodeTypes = {};
  const languages = {};
  let degreeSum = 0;

  graph.forEachNode((id, attrs) => {
    const t = attrs.type ?? 'unknown';
    nodeTypes[t] = (nodeTypes[t] ?? 0) + 1;

    const lang = attrs.language ?? 'unknown';
    languages[lang] = (languages[lang] ?? 0) + 1;

    degreeSum += graph.degree(id);
  });

  const edgeTypes = {};
  const confidenceCounts = {};

  graph.forEachEdge((_edge, attrs) => {
    const rel = attrs.relation ?? 'unknown';
    edgeTypes[rel] = (edgeTypes[rel] ?? 0) + 1;

    const conf = attrs.confidence ?? 'unknown';
    confidenceCounts[conf] = (confidenceCounts[conf] ?? 0) + 1;
  });

  const nodeCount = graph.order;
  const edgeCount = graph.size;
  const avgDegree = nodeCount > 0 ? degreeSum / nodeCount : 0;

  return {
    nodeCount,
    edgeCount,
    avgDegree,
    nodeTypes,
    edgeTypes,
    languages,
    confidenceCounts,
  };
}

/**
 * Compute the blast radius of changing a set of files.
 *
 * Algorithm:
 *  1. Collect seed nodes whose `file` attribute matches any changedFile.
 *  2. BFS via *incoming* edges (callers of the changed nodes), max depth 3.
 *  3. Count unique affected nodes and their communities.
 *  4. riskScore = (nodeRatio * 50) + (communityRatio * 50)
 *
 * @param {import('graphology').default} graph
 * @param {string[]} changedFiles
 * @returns {{
 *   changedFiles: string[],
 *   affectedNodes: string[],
 *   affectedNodeCount: number,
 *   affectedCommunities: (number|string)[],
 *   affectedCommunityCount: number,
 *   riskScore: number,
 *   totalNodes: number,
 *   totalCommunities: number
 * }}
 */
export function computeBlastRadius(graph, changedFiles) {
  const fileSet = new Set(changedFiles);

  // Seed nodes: nodes in changed files
  const seeds = [];
  graph.forEachNode((id, attrs) => {
    if (attrs.file && fileSet.has(attrs.file)) {
      seeds.push(id);
    }
  });

  if (seeds.length === 0) {
    // Count total communities for ratio calculation
    const allCommunities = new Set();
    graph.forEachNode((_id, attrs) => {
      if (attrs.community !== undefined) allCommunities.add(attrs.community);
    });

    return {
      changedFiles,
      affectedNodes: [],
      affectedNodeCount: 0,
      affectedCommunities: [],
      affectedCommunityCount: 0,
      riskScore: 0,
      totalNodes: graph.order,
      totalCommunities: allCommunities.size,
    };
  }

  // BFS over incoming edges (who calls / depends on the changed nodes)
  const MAX_DEPTH = 3;
  const visited = new Set(seeds);
  const queue = seeds.map((id) => ({ id, depth: 0 }));

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (depth >= MAX_DEPTH) continue;

    graph.forEachInNeighbor(id, (neighborId) => {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    });
  }

  const affectedNodes = [...visited];

  // Collect communities from affected nodes
  const affectedCommunitySet = new Set();
  for (const id of affectedNodes) {
    const community = graph.getNodeAttribute(id, 'community');
    if (community !== undefined) affectedCommunitySet.add(community);
  }

  // Total communities in the graph
  const totalCommunitySet = new Set();
  graph.forEachNode((_id, attrs) => {
    if (attrs.community !== undefined) totalCommunitySet.add(attrs.community);
  });

  const totalNodes = graph.order;
  const totalCommunities = totalCommunitySet.size;

  const nodeRatio = totalNodes > 0 ? affectedNodes.length / totalNodes : 0;
  const communityRatio = totalCommunities > 0 ? affectedCommunitySet.size / totalCommunities : 0;
  const riskScore = Math.min(100, Math.round((nodeRatio * 50 + communityRatio * 50) * 100) / 100);

  return {
    changedFiles,
    affectedNodes,
    affectedNodeCount: affectedNodes.length,
    affectedCommunities: [...affectedCommunitySet],
    affectedCommunityCount: affectedCommunitySet.size,
    riskScore,
    totalNodes,
    totalCommunities,
  };
}
