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
    const existing = this.bridges.find(b =>
      b.brainId === brainId && JSON.stringify(b.codeNodes) === JSON.stringify(codeNodes)
    );
    if (existing) return existing;

    const bridge = {
      brainId, codeNodes,
      relation: relation || 'relates_to',
      auto,
      created: new Date().toISOString().split('T')[0],
    };
    this.bridges.push(bridge);
    await this.save();
    return bridge;
  }

  async getBridges() { return this.load(); }

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
    const fileToNodes = new Map();
    graph.forEachNode((id, attrs) => {
      const file = (attrs.file || '').replace(/\\/g, '/');
      if (!file || attrs.type === 'module') return;
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
      const existing = this.bridges.find(b => b.brainId === entry.id && b.auto);
      if (existing) continue;

      const bridge = {
        brainId: entry.id, codeNodes: matchedCodeNodes,
        relation: 'affects', auto: true,
        created: new Date().toISOString().split('T')[0],
      };
      this.bridges.push(bridge);
      newBridges.push(bridge);
    }
    if (newBridges.length > 0) await this.save();
    return newBridges;
  }
}
