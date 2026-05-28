import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

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
  }

  async ensureDirs() {
    await mkdir(this.cachePath, { recursive: true });
  }
}
