/**
 * BrainGraph — N-level graph navigation for brain entries.
 * Supports BFS/DFS traversal, path finding, impact analysis, and cycle detection.
 */
export class BrainGraph {
  constructor(brainManager) {
    this.manager = brainManager;
  }

  /**
   * Build adjacency map from index entries
   * @returns {Map<string, Array<{id, rel}>>}
   */
  async _buildAdjacencyMap(relTypes) {
    const index = await this.manager.loadIndex();
    const adj = new Map();

    for (const entry of index.entries) {
      if (!adj.has(entry.id)) adj.set(entry.id, []);

      if (entry.related) {
        for (const rel of entry.related) {
          if (relTypes && relTypes.length > 0 && !relTypes.includes(rel.rel)) continue;
          adj.get(entry.id).push({ id: rel.id, rel: rel.rel });
        }
      }
    }

    return adj;
  }

  /**
   * BFS/DFS traversal from a starting entry
   * @param {string} startId - Starting entry ID
   * @param {Object} options
   * @param {number} [options.maxDepth=3] - Maximum traversal depth
   * @param {string[]} [options.relTypes] - Filter by relation types
   * @returns {{ nodes: Array<{id, title, type, status, depth}>, edges: Array<{from, to, rel}> }}
   */
  async traverse(startId, { maxDepth = 3, relTypes } = {}) {
    const index = await this.manager.loadIndex();
    const entryMap = new Map(index.entries.map(e => [e.id, e]));
    const adj = await this._buildAdjacencyMap(relTypes);

    const visited = new Set();
    const nodes = [];
    const edges = [];
    const queue = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const entry = entryMap.get(id);
      if (entry) {
        nodes.push({
          id: entry.id,
          title: entry.title,
          type: entry.type,
          status: entry.status,
          depth
        });
      }

      const neighbors = adj.get(id) || [];
      for (const { id: neighborId, rel } of neighbors) {
        edges.push({ from: id, to: neighborId, rel });
        if (!visited.has(neighborId) && depth + 1 <= maxDepth) {
          queue.push({ id: neighborId, depth: depth + 1 });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Find shortest path between two entries using BFS
   * @returns {Array<{id, title, rel}>} - Path from start to target, or empty if no path
   */
  async findPath(fromId, toId) {
    const index = await this.manager.loadIndex();
    const entryMap = new Map(index.entries.map(e => [e.id, e]));
    const adj = await this._buildAdjacencyMap();

    const visited = new Set();
    const parent = new Map(); // id -> {parentId, rel}
    const queue = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === toId) {
        // Reconstruct path
        const path = [];
        let node = toId;
        while (node !== fromId) {
          const { parentId, rel } = parent.get(node);
          const entry = entryMap.get(node);
          path.unshift({ id: node, title: entry?.title || node, rel });
          node = parentId;
        }
        const startEntry = entryMap.get(fromId);
        path.unshift({ id: fromId, title: startEntry?.title || fromId, rel: null });
        return path;
      }

      const neighbors = adj.get(current) || [];
      for (const { id: neighborId, rel } of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          parent.set(neighborId, { parentId: current, rel });
          queue.push(neighborId);
        }
      }
    }

    return []; // No path found
  }

  /**
   * Impact analysis: find all entries that depend on a given entry (reverse traversal)
   * Finds entries that reference the given entry via any relation
   * @returns {Array<{id, title, type, status, rel, depth}>}
   */
  async dependents(entryId, maxDepth = 3) {
    const index = await this.manager.loadIndex();
    const entryMap = new Map(index.entries.map(e => [e.id, e]));

    // Build reverse adjacency: who points TO each entry?
    const reverseAdj = new Map();
    for (const entry of index.entries) {
      if (entry.related) {
        for (const rel of entry.related) {
          if (!reverseAdj.has(rel.id)) reverseAdj.set(rel.id, []);
          reverseAdj.get(rel.id).push({ id: entry.id, rel: rel.rel });
        }
      }
    }

    const visited = new Set();
    const dependentsList = [];
    const queue = [{ id: entryId, depth: 0 }];
    visited.add(entryId);

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (depth > maxDepth) continue;

      const refs = reverseAdj.get(id) || [];
      for (const { id: refId, rel } of refs) {
        if (visited.has(refId)) continue;
        visited.add(refId);

        const entry = entryMap.get(refId);
        if (entry) {
          dependentsList.push({
            id: entry.id,
            title: entry.title,
            type: entry.type,
            status: entry.status,
            rel,
            depth: depth + 1
          });
          queue.push({ id: refId, depth: depth + 1 });
        }
      }
    }

    return dependentsList;
  }

  /**
   * Detect cycles in the relation graph using DFS
   * @returns {Array<Array<string>>} - Arrays of entry IDs forming cycles
   */
  async findCycles() {
    const adj = await this._buildAdjacencyMap();
    const allIds = [...adj.keys()];

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map(allIds.map(id => [id, WHITE]));
    const parent = new Map();
    const cycles = [];

    const dfs = (nodeId, path) => {
      color.set(nodeId, GRAY);
      path.push(nodeId);

      const neighbors = adj.get(nodeId) || [];
      for (const { id: neighborId } of neighbors) {
        if (color.get(neighborId) === GRAY) {
          // Found a cycle: extract it from path
          const cycleStart = path.indexOf(neighborId);
          if (cycleStart !== -1) {
            cycles.push([...path.slice(cycleStart), neighborId]);
          }
        } else if (color.get(neighborId) === WHITE) {
          dfs(neighborId, path);
        }
      }

      path.pop();
      color.set(nodeId, BLACK);
    };

    for (const id of allIds) {
      if (color.get(id) === WHITE) {
        dfs(id, []);
      }
    }

    return cycles;
  }
}
