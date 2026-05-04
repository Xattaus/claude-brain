import { buildResearchBody } from '../utils/body-builders.js';
import { getTranslator } from '../i18n.js';

export class SessionIntegrator {
  constructor(manager) {
    this.manager = manager;
    this.t = getTranslator('en');
  }

  async recordResearch(args) {
    const body = buildResearchBody(args, this.t);
    const result = await this.manager.createEntry({
      type: 'research',
      prefix: 'RES',
      dirName: 'research',
      title: args.title,
      frontmatter: {
        status: 'completed',
        tags: args.tags || [],
        files: args.files || [],
        related: args.related || []
      },
      body
    });

    if (args.related) {
      for (const rel of args.related) {
        try {
          await this.manager.linkEntries(result.id, rel.id, rel.rel);
        } catch { /* skip */ }
      }
    }

    return result;
  }
}
