import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { scanFiles } from './scan.js';
import { extractFromSource } from './extract.js';
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
    this.bridgesPath = join(this.codeGraphPath, 'bridges.json');
    this.cachePath = join(this.codeGraphPath, 'cache', 'ast');
    this.graph = null;
    this._communities = null;
    this._analysis = null;
    this.cache = new ASTCache(this.cachePath);
    this.bridge = new BridgeManager(this.bridgesPath);
  }

  async ensureDirs() {
    await mkdir(this.cachePath, { recursive: true });
  }

  /**
   * Build the full code graph from the project source files.
   *
   * Pipeline: scan -> extract -> build -> resolve -> cluster -> analyze -> save
   *
   * @param {object} [options]
   * @returns {Promise<{ nodeCount, edgeCount, communityCount, fileCount }>}
   */
  async build(options = {}) {
    await this.ensureDirs();

    // 1. Scan for source files
    const files = await scanFiles(this.projectPath);

    // 2. Extract AST information from each file
    const extractions = [];
    for (const file of files) {
      let content;
      try {
        content = await readFile(file.absolutePath, 'utf-8');
      } catch {
        continue;
      }

      const extraction = await this.cache.getOrExtract(
        file.absolutePath,
        content,
        () => extractFromSource(content, file.relativePath, file.language),
      );

      // Map extraction node fields to what buildGraph expects:
      //   filePath -> file, startLine -> line, and add language
      const mappedNodes = extraction.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        type: node.type,
        file: node.filePath ?? node.file ?? '',
        line: node.startLine ?? node.line ?? 0,
        endLine: node.endLine ?? 0,
        language: node.language ?? file.language,
      }));

      extractions.push({ nodes: mappedNodes, edges: extraction.edges });
    }

    // 3. Build graph and resolve references
    this.graph = buildGraph(extractions);
    resolveReferences(this.graph);

    // 4. Community detection (needs >= 3 nodes for Louvain)
    let communityResult = { count: 0, modularity: 0 };
    if (this.graph.order >= 3) {
      try {
        communityResult = detectCommunities(this.graph);
      } catch {
        // Community detection can fail on certain graph shapes
        communityResult = { count: 0, modularity: 0 };
      }
    }
    this._communities = getCommunityStats(this.graph);

    // 5. Analysis
    const godNodes = findGodNodes(this.graph);
    const surprises = findSurprises(this.graph);
    const stats = getGraphStats(this.graph);
    this._analysis = { godNodes, surprises, stats };

    // 6. Save
    await this.save();

    return {
      nodeCount: this.graph.order,
      edgeCount: this.graph.size,
      communityCount: communityResult.count,
      fileCount: files.length,
    };
  }

  /**
   * Save graph, communities, and analysis to disk.
   */
  async save() {
    await this.ensureDirs();

    const graphJSON = graphToJSON(this.graph);
    await writeFile(this.graphPath, JSON.stringify(graphJSON, null, 2), 'utf-8');

    if (this._communities) {
      await writeFile(this.communitiesPath, JSON.stringify(this._communities, null, 2), 'utf-8');
    }

    if (this._analysis) {
      await writeFile(this.analysisPath, JSON.stringify(this._analysis, null, 2), 'utf-8');
    }
  }

  /**
   * Load a previously saved graph from disk.
   * @returns {Promise<boolean>} true if loaded successfully, false otherwise
   */
  async load() {
    try {
      if (!existsSync(this.graphPath)) return false;

      const graphData = JSON.parse(await readFile(this.graphPath, 'utf-8'));
      this.graph = graphFromJSON(graphData);

      if (existsSync(this.communitiesPath)) {
        this._communities = JSON.parse(await readFile(this.communitiesPath, 'utf-8'));
      }

      if (existsSync(this.analysisPath)) {
        this._analysis = JSON.parse(await readFile(this.analysisPath, 'utf-8'));
      }

      return true;
    } catch {
      this.graph = null;
      this._communities = null;
      this._analysis = null;
      return false;
    }
  }

  /**
   * Ensure the graph is loaded. If not loaded, attempt to load from disk.
   * Throws if the graph is still null after loading attempt.
   */
  async ensureLoaded() {
    if (!this.graph) {
      const loaded = await this.load();
      if (!loaded || !this.graph) {
        throw new Error('CodeGraph: no graph available. Call build() first or ensure saved data exists.');
      }
    }
  }

  /**
   * Query the graph for nodes relevant to the given query string.
   * @param {string} queryString
   * @param {object} [options]
   * @returns {{ nodes: object[], edges: object[], text: string }}
   */
  query(queryString, options = {}) {
    if (!this.graph) throw new Error('CodeGraph: no graph loaded. Call build() or load() first.');
    return queryGraph(this.graph, queryString, options);
  }

  /**
   * Find the shortest path between two nodes.
   * @param {string} fromId
   * @param {string} toId
   * @returns {string[]}
   */
  shortestPath(fromId, toId) {
    if (!this.graph) throw new Error('CodeGraph: no graph loaded.');
    return findShortestPath(this.graph, fromId, toId);
  }

  /**
   * Get all neighbors of a node.
   * @param {string} nodeId
   * @param {object} [options]
   * @returns {Array}
   */
  neighbors(nodeId, options = {}) {
    if (!this.graph) throw new Error('CodeGraph: no graph loaded.');
    return getNeighbors(this.graph, nodeId, options);
  }

  /**
   * Get a single node by ID with its attributes and degree info.
   * @param {string} nodeId
   * @returns {object|null}
   */
  getNode(nodeId) {
    if (!this.graph || !this.graph.hasNode(nodeId)) return null;
    const attrs = this.graph.getNodeAttributes(nodeId);
    return {
      id: nodeId,
      ...attrs,
      degree: this.graph.degree(nodeId),
      inDegree: this.graph.inDegree(nodeId),
      outDegree: this.graph.outDegree(nodeId),
    };
  }

  /**
   * Get aggregate statistics for the graph.
   * @returns {object}
   */
  getStats() {
    if (!this.graph) throw new Error('CodeGraph: no graph loaded.');
    return getGraphStats(this.graph);
  }

  /**
   * Get community stats.
   * @returns {object|null}
   */
  getCommunities() {
    return this._communities;
  }

  /**
   * Get a specific community by ID.
   * @param {number|string} communityId
   * @returns {object|null}
   */
  getCommunity(communityId) {
    if (!this._communities || !this._communities.communities) return null;
    return this._communities.communities.find((c) => c.id === communityId) || null;
  }

  /**
   * Get god nodes (high-degree hubs).
   * @returns {Array}
   */
  getGodNodes() {
    return this._analysis?.godNodes ?? [];
  }

  /**
   * Get surprising edges.
   * @returns {Array}
   */
  getSurprises() {
    return this._analysis?.surprises ?? [];
  }

  /**
   * Compute blast radius for a set of changed files.
   * @param {string[]} changedFiles
   * @returns {object}
   */
  blastRadius(changedFiles) {
    if (!this.graph) throw new Error('CodeGraph: no graph loaded.');
    return computeBlastRadius(this.graph, changedFiles);
  }

  /**
   * Auto-detect bridges between brain entries and code nodes.
   * @param {Array} brainEntries
   * @returns {Promise<Array>}
   */
  async autoBridge(brainEntries) {
    if (!this.graph) throw new Error('CodeGraph: no graph loaded.');
    return this.bridge.autoDetect(this.graph, brainEntries);
  }
}
