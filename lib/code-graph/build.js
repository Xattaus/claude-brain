import Graph from 'graphology';
import path from 'node:path';

/**
 * Builds a graphology directed multigraph from an array of extraction results.
 * Each extraction is { nodes: [...], edges: [...] }.
 *
 * Phase 1: Add all nodes (deduplicated by id).
 * Phase 2: Add resolved edges immediately; store placeholder edges as pending.
 *
 * @param {Array<{nodes: Array, edges: Array}>} extractions
 * @returns {Graph} graphology directed multigraph
 */
export function buildGraph(extractions) {
  const graph = new Graph({ multi: true, type: 'directed' });

  // Phase 1: Add all nodes, skipping duplicates
  for (const extraction of extractions) {
    for (const node of extraction.nodes ?? []) {
      if (!graph.hasNode(node.id)) {
        graph.addNode(node.id, {
          label: node.label ?? node.id,
          type: node.type ?? 'unknown',
          file: node.file ?? '',
          line: node.line ?? 0,
          endLine: node.endLine ?? 0,
          language: node.language ?? '',
        });
      }
    }
  }

  // Phase 2: Add edges — defer placeholder targets
  const pendingEdges = [];
  for (const extraction of extractions) {
    for (const edge of extraction.edges ?? []) {
      const target = edge.target ?? '';
      if (
        target.startsWith('__call__::') ||
        target.startsWith('__import__::') ||
        target.startsWith('__unresolved__::')
      ) {
        pendingEdges.push(edge);
        continue;
      }
      if (graph.hasNode(edge.source) && graph.hasNode(target)) {
        graph.addEdge(edge.source, target, {
          relation: edge.relation ?? 'unknown',
          confidence: edge.confidence ?? 'EXTRACTED',
          file: edge.file ?? '',
          line: edge.line ?? 0,
          context: edge.context ?? '',
        });
      }
    }
  }

  // Attach pending edges for resolveReferences()
  graph._pendingEdges = pendingEdges;
  return graph;
}

/**
 * Resolves placeholder edge targets (__call__::, __import__::, __unresolved__::)
 * to actual node IDs present in the graph.
 *
 * Confidence tiers:
 *   EXTRACTED  — direct structural edge (not touched here)
 *   INFERRED   — single unambiguous match found
 *   AMBIGUOUS  — multiple matches; best-effort by same-file preference
 *
 * @param {Graph} graph — mutated in place
 */
export function resolveReferences(graph) {
  const pending = graph._pendingEdges ?? [];
  if (pending.length === 0) return;

  // Build lookup maps
  // nodesByLabel: label (lower) → [nodeId, ...]
  const nodesByLabel = new Map();
  // modulesByFileStem: stem (no ext) → nodeId  (for module nodes)
  const modulesByFileStem = new Map();

  graph.forEachNode((nodeId, attrs) => {
    const label = (attrs.label ?? '').toLowerCase();
    if (!nodesByLabel.has(label)) nodesByLabel.set(label, []);
    nodesByLabel.get(label).push(nodeId);

    if (attrs.type === 'module' && attrs.file) {
      // Store both full path and stem (no extension)
      const stem = stripExt(attrs.file);
      modulesByFileStem.set(stem, nodeId);
      // Also store the full file path for exact matching
      modulesByFileStem.set(attrs.file, nodeId);
    }
  });

  for (const edge of pending) {
    const target = edge.target ?? '';
    const source = edge.source ?? '';

    if (!graph.hasNode(source)) continue;

    let resolvedTarget = null;
    let confidence = 'INFERRED';

    if (target.startsWith('__call__::') || target.startsWith('__unresolved__::')) {
      const name = target.startsWith('__call__::')
        ? target.slice('__call__::'.length)
        : target.slice('__unresolved__::'.length);

      const nameLower = name.toLowerCase();
      const candidates = nodesByLabel.get(nameLower) ?? [];

      if (candidates.length === 1) {
        resolvedTarget = candidates[0];
        confidence = 'INFERRED';
      } else if (candidates.length > 1) {
        // Prefer same file as source
        const sourceFile = graph.hasNode(source)
          ? graph.getNodeAttribute(source, 'file')
          : '';
        const sameFile = candidates.filter(
          (c) => graph.getNodeAttribute(c, 'file') === sourceFile
        );
        if (sameFile.length === 1) {
          resolvedTarget = sameFile[0];
          confidence = 'INFERRED';
        } else {
          // Pick the first candidate; mark AMBIGUOUS
          resolvedTarget = candidates[0];
          confidence = 'AMBIGUOUS';
        }
      }
    } else if (target.startsWith('__import__::')) {
      const importPath = target.slice('__import__::'.length);
      const sourceFile = graph.hasNode(source)
        ? graph.getNodeAttribute(source, 'file')
        : '';
      const sourceDir = path.dirname(sourceFile);

      // Resolve the import path relative to the source file's directory
      let candidate = null;
      if (importPath.startsWith('.')) {
        const resolved = path.posix.normalize(
          path.posix.join(sourceDir.replace(/\\/g, '/'), importPath)
        );
        // Try with common JS/TS extensions
        const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
        for (const ext of extensions) {
          const attempt = resolved + ext;
          if (modulesByFileStem.has(attempt)) {
            candidate = modulesByFileStem.get(attempt);
            break;
          }
        }
        // Also try stripping extension from resolved for stem match
        if (!candidate) {
          const stem = stripExt(resolved);
          if (modulesByFileStem.has(stem)) {
            candidate = modulesByFileStem.get(stem);
          }
        }
      } else {
        // Bare import — look up by label (module name)
        const basename = importPath.split('/').pop() ?? importPath;
        const candidates = nodesByLabel.get(basename.toLowerCase()) ?? [];
        if (candidates.length === 1) candidate = candidates[0];
      }

      if (candidate) {
        resolvedTarget = candidate;
        confidence = 'INFERRED';
      }
    }

    if (resolvedTarget && graph.hasNode(resolvedTarget)) {
      graph.addEdge(source, resolvedTarget, {
        relation: edge.relation ?? 'unknown',
        confidence,
        file: edge.file ?? '',
        line: edge.line ?? 0,
        context: edge.context ?? '',
      });
    }
  }

  // Clear pending after resolution
  graph._pendingEdges = [];
}

/**
 * Serializes a graphology graph to a plain JSON-compatible object.
 *
 * @param {Graph} graph
 * @returns {{ nodes: Array, edges: Array }}
 */
export function graphToJSON(graph) {
  const nodes = [];
  const edges = [];

  graph.forEachNode((nodeId, attrs) => {
    nodes.push({ id: nodeId, ...attrs });
  });

  graph.forEachEdge((edgeId, attrs, source, target) => {
    edges.push({ source, target, ...attrs });
  });

  return { nodes, edges };
}

/**
 * Deserializes a plain JSON object back to a graphology directed multigraph.
 *
 * @param {{ nodes: Array, edges: Array }} data
 * @returns {Graph}
 */
export function graphFromJSON(data) {
  const graph = new Graph({ multi: true, type: 'directed' });

  for (const node of data.nodes ?? []) {
    const { id, ...attrs } = node;
    if (!graph.hasNode(id)) {
      graph.addNode(id, attrs);
    }
  }

  for (const edge of data.edges ?? []) {
    const { source, target, ...attrs } = edge;
    if (graph.hasNode(source) && graph.hasNode(target)) {
      graph.addEdge(source, target, attrs);
    }
  }

  return graph;
}

// --- helpers ---

/**
 * Strips the file extension from a path, returning the stem.
 * e.g. "src/a.js" → "src/a"
 */
function stripExt(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const lastDot = normalized.lastIndexOf('.');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastDot > lastSlash) {
    return normalized.slice(0, lastDot);
  }
  return normalized;
}
