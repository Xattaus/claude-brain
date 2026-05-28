// Code graph handlers: build, query, node, neighbors, path, community, stats, blast, gods, surprises, health, bridge, bridge_auto

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
    try {
      const cg = getCodeGraph(ctx);
      const result = await cg.build({ mode: args.mode || 'full' });

      // Auto-bridge after build
      let bridgeCount = 0;
      try {
        const index = await ctx.manager.loadIndex();
        const newBridges = await cg.autoBridge(index.entries);
        bridgeCount = newBridges.length;
      } catch { /* non-critical */ }

      let text = `Code graph built successfully.\n`;
      text += `- Files scanned: ${result.fileCount}\n`;
      text += `- Nodes: ${result.nodeCount}\n`;
      text += `- Edges: ${result.edgeCount}\n`;
      text += `- Communities: ${result.communityCount}\n`;
      if (bridgeCount > 0) {
        text += `- Auto-bridges created: ${bridgeCount}`;
      }
      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error building code graph: ${error.message}` }];
    }
  },

  brain_code_query: async (ctx, args) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const result = cg.query(args.query, {
        budget: args.budget,
        mode: args.mode,
        maxDepth: args.max_depth,
      });
      return [{ type: 'text', text: result.text || 'No results found.' }];
    } catch (error) {
      return [{ type: 'text', text: `Error querying code graph: ${error.message}` }];
    }
  },

  brain_code_node: async (ctx, args) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const node = cg.getNode(args.node_id);
      if (!node) {
        return [{ type: 'text', text: `Node not found: ${args.node_id}` }];
      }

      let text = `## Node: ${node.id}\n\n`;
      text += `- Type: ${node.type || 'unknown'}\n`;
      text += `- Label: ${node.label || node.id}\n`;
      text += `- File: ${node.file || 'unknown'}\n`;
      text += `- Line: ${node.line || '?'}`;
      if (node.endLine) text += `-${node.endLine}`;
      text += '\n';
      text += `- Language: ${node.language || 'unknown'}\n`;
      text += `- Degree: ${node.degree} (in: ${node.inDegree}, out: ${node.outDegree})\n`;
      if (node.community !== undefined) {
        text += `- Community: ${node.community}\n`;
      }

      // Neighbors
      const neighbors = cg.neighbors(args.node_id);
      if (neighbors.length > 0) {
        text += `\n### Neighbors (${neighbors.length})\n`;
        for (const n of neighbors.slice(0, 20)) {
          text += `- ${n.direction === 'out' ? '→' : '←'} ${n.id} [${n.relation || '?'}]\n`;
        }
        if (neighbors.length > 20) {
          text += `... and ${neighbors.length - 20} more\n`;
        }
      }

      // Bridge entries
      try {
        const bridges = await cg.bridge.getBridgesForCodeNode(args.node_id);
        if (bridges.length > 0) {
          text += `\n### Brain Entry Links\n`;
          for (const b of bridges) {
            text += `- ${b.brainId} [${b.relation}]${b.auto ? ' (auto)' : ''}\n`;
          }
        }
      } catch { /* non-critical */ }

      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error getting node: ${error.message}` }];
    }
  },

  brain_code_neighbors: async (ctx, args) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const neighbors = cg.neighbors(args.node_id, { relation: args.relation });

      if (neighbors.length === 0) {
        return [{ type: 'text', text: `No neighbors found for ${args.node_id}${args.relation ? ` with relation "${args.relation}"` : ''}` }];
      }

      let text = `## Neighbors of ${args.node_id}`;
      if (args.relation) text += ` (${args.relation})`;
      text += `\n\n`;
      for (const n of neighbors) {
        text += `- ${n.direction === 'out' ? '→' : '←'} ${n.id} [${n.relation || '?'}]`;
        if (n.type) text += ` (${n.type})`;
        text += '\n';
      }
      text += `\nTotal: ${neighbors.length}`;
      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error getting neighbors: ${error.message}` }];
    }
  },

  brain_code_path: async (ctx, args) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const path = cg.shortestPath(args.from, args.to);

      if (!path || path.length === 0) {
        return [{ type: 'text', text: `No path found between ${args.from} and ${args.to}` }];
      }

      let text = `## Shortest path: ${args.from} → ${args.to}\n\n`;
      text += `Length: ${path.length - 1} hops\n\n`;
      for (let i = 0; i < path.length; i++) {
        text += `${i + 1}. ${path[i]}`;
        if (i < path.length - 1) text += ' →';
        text += '\n';
      }
      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error finding path: ${error.message}` }];
    }
  },

  brain_code_community: async (ctx, args) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const community = cg.getCommunity(args.community_id);

      if (!community) {
        return [{ type: 'text', text: `Community not found: ${args.community_id}` }];
      }

      let text = `## Community ${community.id}\n\n`;
      text += `- Nodes: ${community.nodeCount || community.nodes?.length || 0}\n`;
      if (community.languages) {
        text += `- Languages: ${Object.entries(community.languages).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
      }
      if (community.nodeTypes) {
        text += `- Node types: ${Object.entries(community.nodeTypes).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
      }
      if (community.files) {
        text += `- Files: ${community.files.slice(0, 10).join(', ')}`;
        if (community.files.length > 10) text += ` ... +${community.files.length - 10} more`;
        text += '\n';
      }
      if (community.nodes) {
        text += `\n### Nodes\n`;
        for (const n of community.nodes.slice(0, 30)) {
          text += `- ${typeof n === 'string' ? n : n.id || n}\n`;
        }
        if (community.nodes.length > 30) {
          text += `... and ${community.nodes.length - 30} more\n`;
        }
      }
      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error getting community: ${error.message}` }];
    }
  },

  brain_code_stats: async (ctx) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const stats = cg.getStats();
      const communities = cg.getCommunities();

      let text = `## Code Graph Statistics\n\n`;
      text += `- Nodes: ${stats.nodeCount}\n`;
      text += `- Edges: ${stats.edgeCount}\n`;
      text += `- Avg degree: ${stats.avgDegree.toFixed(1)}\n`;

      if (stats.languages && Object.keys(stats.languages).length > 0) {
        text += `\n### Languages\n`;
        for (const [lang, count] of Object.entries(stats.languages)) {
          text += `- ${lang}: ${count}\n`;
        }
      }

      if (stats.nodeTypes && Object.keys(stats.nodeTypes).length > 0) {
        text += `\n### Node Types\n`;
        for (const [type, count] of Object.entries(stats.nodeTypes)) {
          text += `- ${type}: ${count}\n`;
        }
      }

      if (stats.edgeTypes && Object.keys(stats.edgeTypes).length > 0) {
        text += `\n### Edge Types\n`;
        for (const [type, count] of Object.entries(stats.edgeTypes)) {
          text += `- ${type}: ${count}\n`;
        }
      }

      if (stats.confidenceCounts && Object.keys(stats.confidenceCounts).length > 0) {
        text += `\n### Confidence\n`;
        for (const [level, count] of Object.entries(stats.confidenceCounts)) {
          text += `- ${level}: ${count}\n`;
        }
      }

      if (communities) {
        text += `\n### Communities\n`;
        text += `- Total: ${communities.count || communities.communities?.length || 0}\n`;
        if (communities.modularity !== undefined) {
          text += `- Modularity: ${communities.modularity.toFixed(3)}\n`;
        }
      }

      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error getting stats: ${error.message}` }];
    }
  },

  brain_code_blast: async (ctx, args) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const result = cg.blastRadius(args.files);

      let text = `## Blast Radius Analysis\n\n`;
      text += `Changed files: ${result.changedFiles.join(', ')}\n\n`;
      text += `- Affected nodes: ${result.affectedNodeCount} / ${result.totalNodes}\n`;
      text += `- Affected communities: ${result.affectedCommunityCount} / ${result.totalCommunities}\n`;
      text += `- Risk score: ${result.riskScore}\n`;

      if (result.affectedCommunities.length > 0) {
        text += `\n### Affected Communities\n`;
        for (const c of result.affectedCommunities) {
          text += `- Community ${c}\n`;
        }
      }

      if (result.affectedNodes.length > 0 && result.affectedNodes.length <= 30) {
        text += `\n### Affected Nodes\n`;
        for (const n of result.affectedNodes) {
          text += `- ${n}\n`;
        }
      } else if (result.affectedNodes.length > 30) {
        text += `\n### Affected Nodes (showing first 30 of ${result.affectedNodes.length})\n`;
        for (const n of result.affectedNodes.slice(0, 30)) {
          text += `- ${n}\n`;
        }
      }

      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error computing blast radius: ${error.message}` }];
    }
  },

  brain_code_gods: async (ctx) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const gods = cg.getGodNodes();

      if (gods.length === 0) {
        return [{ type: 'text', text: 'No god nodes found (no overly-connected nodes above threshold).' }];
      }

      let text = `## God Nodes (${gods.length})\n\n`;
      for (const g of gods) {
        text += `- **${g.id}** [${g.type}] — degree: ${g.degree} (in: ${g.inDegree}, out: ${g.outDegree})`;
        if (g.file) text += ` — ${g.file}`;
        text += '\n';
      }
      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error getting god nodes: ${error.message}` }];
    }
  },

  brain_code_surprises: async (ctx) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const surprises = cg.getSurprises();

      if (surprises.length === 0) {
        return [{ type: 'text', text: 'No surprising connections found.' }];
      }

      let text = `## Surprising Connections (${surprises.length})\n\n`;
      for (const s of surprises) {
        text += `- ${s.source} → ${s.target} (score: ${s.score.toFixed(1)})\n`;
        text += `  Factors: ${s.factors.join(', ')}\n`;
        if (s.relation) text += `  Relation: ${s.relation}\n`;
        if (s.confidence) text += `  Confidence: ${s.confidence}\n`;
      }
      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error getting surprises: ${error.message}` }];
    }
  },

  brain_code_health: async (ctx) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();

      const stats = cg.getStats();
      const gods = cg.getGodNodes();
      const surprises = cg.getSurprises();

      // Find orphan nodes (degree 0)
      const orphans = [];
      cg.graph.forEachNode((id, attrs) => {
        if (cg.graph.degree(id) === 0) {
          orphans.push({ id, type: attrs.type, file: attrs.file });
        }
      });

      // Count ambiguous edges
      let ambiguousCount = 0;
      cg.graph.forEachEdge((_edge, attrs) => {
        if (attrs.confidence === 'AMBIGUOUS') ambiguousCount++;
      });

      let text = `## Code Graph Health Report\n\n`;
      text += `### Overview\n`;
      text += `- Nodes: ${stats.nodeCount}, Edges: ${stats.edgeCount}\n`;
      text += `- Avg degree: ${stats.avgDegree.toFixed(1)}\n\n`;

      // Health issues
      const issues = [];

      if (gods.length > 0) {
        issues.push(`${gods.length} god node(s) — consider refactoring`);
        text += `### God Nodes (${gods.length})\n`;
        for (const g of gods.slice(0, 5)) {
          text += `- ${g.id} (degree: ${g.degree})\n`;
        }
        if (gods.length > 5) text += `... and ${gods.length - 5} more\n`;
        text += '\n';
      }

      if (orphans.length > 0) {
        issues.push(`${orphans.length} orphan node(s) — isolated code`);
        text += `### Orphan Nodes (${orphans.length})\n`;
        for (const o of orphans.slice(0, 10)) {
          text += `- ${o.id} [${o.type}] — ${o.file || 'unknown file'}\n`;
        }
        if (orphans.length > 10) text += `... and ${orphans.length - 10} more\n`;
        text += '\n';
      }

      if (ambiguousCount > 0) {
        issues.push(`${ambiguousCount} ambiguous edge(s) — low confidence references`);
        text += `### Ambiguous Edges: ${ambiguousCount}\n\n`;
      }

      const ambiguousSurprises = surprises.filter(s => s.factors.includes('ambiguous-confidence'));
      const crossLangSurprises = surprises.filter(s => s.factors.includes('cross-language'));

      if (crossLangSurprises.length > 0) {
        issues.push(`${crossLangSurprises.length} cross-language connection(s)`);
      }

      if (issues.length === 0) {
        text += `### Status: Healthy\nNo significant issues found.\n`;
      } else {
        text += `### Issues Summary\n`;
        for (const issue of issues) {
          text += `- ${issue}\n`;
        }
      }

      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error generating health report: ${error.message}` }];
    }
  },

  brain_bridge: async (ctx, args) => {
    try {
      const cg = getCodeGraph(ctx);
      const bridge = await cg.bridge.addBridge({
        brainId: args.brain_id,
        codeNodes: args.code_nodes,
        relation: args.relation || 'relates_to',
        auto: false,
      });

      return [{ type: 'text', text: `Bridge created: ${bridge.brainId} —[${bridge.relation}]→ ${bridge.codeNodes.join(', ')}` }];
    } catch (error) {
      return [{ type: 'text', text: `Error creating bridge: ${error.message}` }];
    }
  },

  brain_code_visualize: async (ctx) => {
    const { fork } = await import('node:child_process');
    const { dirname, join: pathJoin } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __fn = fileURLToPath(import.meta.url);
    const __dn = dirname(__fn);
    const vizScript = pathJoin(__dn, '..', '..', 'visualize.js');
    const projectPath = process.env.BRAIN_PROJECT_PATH;

    try {
      const child = fork(vizScript, [projectPath, '--code'], { silent: true });
      const url = await new Promise((resolve) => {
        let output = '';
        child.stdout.on('data', (data) => { output += data.toString(); });
        child.stderr.on('data', (data) => { output += data.toString(); });
        setTimeout(() => {
          const match = output.match(/\u2192\s+(http:\/\/[^\s]+)/);
          if (match) resolve(match[1]);
          else resolve('http://127.0.0.1 (check terminal)');
        }, 2000);
      });
      child.unref();
      return [{ type: 'text', text: `## Code Graph Visualizer Launched\n\nOpened interactive code graph in browser.\n\n**URL:** ${url}\n\nAlso available: ${url}/brain (knowledge graph)\n\nPress Ctrl+C in the terminal to stop the visualizer server.` }];
    } catch (err) {
      return [{ type: 'text', text: `Error launching code graph visualizer: ${err.message}` }];
    }
  },

  brain_bridge_auto: async (ctx) => {
    try {
      const cg = getCodeGraph(ctx);
      await cg.ensureLoaded();
      const index = await ctx.manager.loadIndex();
      const newBridges = await cg.autoBridge(index.entries);

      if (newBridges.length === 0) {
        return [{ type: 'text', text: 'No new bridges detected. All matching entries already linked.' }];
      }

      let text = `## Auto-Bridges Created (${newBridges.length})\n\n`;
      for (const b of newBridges) {
        text += `- ${b.brainId} —[${b.relation}]→ ${b.codeNodes.length} code node(s)\n`;
      }
      return [{ type: 'text', text }];
    } catch (error) {
      return [{ type: 'text', text: `Error auto-bridging: ${error.message}` }];
    }
  },
};
