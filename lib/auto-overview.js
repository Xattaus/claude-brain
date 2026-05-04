import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TECH_MAP = {
  '.rs': 'Rust',
  '.tsx': 'TypeScript/React',
  '.ts': 'TypeScript',
  '.js': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.java': 'Java',
  '.sql': 'SQL/SQLite',
  '.vue': 'Vue.js',
  '.svelte': 'Svelte',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.html': 'HTML'
};

export class AutoOverview {
  constructor(manager) {
    this.manager = manager;
  }

  static detectTechStack(files) {
    const detected = new Set();
    for (const file of files) {
      for (const [ext, tech] of Object.entries(TECH_MAP)) {
        if (file.endsWith(ext)) {
          detected.add(tech);
          break;
        }
      }
    }
    if (detected.has('TypeScript/React') && detected.has('TypeScript')) {
      detected.delete('TypeScript');
    }
    return [...detected];
  }

  async needsRegeneration() {
    const overviewPath = join(this.manager.brainPath, 'overview.md');
    try {
      const content = await readFile(overviewPath, 'utf-8');
      if (content.includes('<!-- manual -->')) return false;
      if (content.trim().length < 100) return true;
      const dateMatch = content.match(/Auto-generated (\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) return true;
      const genDate = new Date(dateMatch[1]);
      const daysSince = (Date.now() - genDate.getTime()) / 86400000;
      if (daysSince < 7) return false;
      const index = await this.manager.loadIndex();
      const hasNewEntries = index.entries.some(e => new Date(e.date) > genDate);
      return hasNewEntries;
    } catch {
      return true;
    }
  }

  async generate() {
    const manifest = await this.manager.loadManifest();
    const index = await this.manager.loadIndex();
    const projectName = manifest.projectName || 'Project';
    const entries = index.entries;

    const allFiles = entries.flatMap(e => e.files || []);
    const techStack = AutoOverview.detectTechStack(allFiles);

    const decisions = entries.filter(e => e.type === 'decision' && e.status === 'active');
    const implementations = entries
      .filter(e => e.type === 'implementation')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 5);
    const lessons = entries
      .filter(e => e.type === 'lesson' && e.severity === 'high')
      .slice(0, 5);
    const plans = entries
      .filter(e => e.type === 'plan' && (e.status === 'partial' || e.status === 'in_progress' || e.status === 'planned'))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    let text = `# ${projectName}\n\n`;
    text += `> ${entries.length} brain entries | ${decisions.length} active decisions | Auto-managed overview\n\n`;

    if (techStack.length > 0) {
      text += '## Tech Stack\n';
      for (const tech of techStack) { text += `- ${tech}\n`; }
      text += '\n';
    }

    if (decisions.length > 0) {
      text += '## Architecture (Key Decisions)\n';
      for (const d of decisions.slice(0, 10)) { text += `- **${d.id}**: ${d.title}\n`; }
      text += '\n';
    }

    if (implementations.length > 0) {
      text += '## Recent Development\n';
      for (const i of implementations) { text += `- **${i.id}** [${i.date}]: ${i.title}\n`; }
      text += '\n';
    }

    if (plans.length > 0) {
      text += '## Active Plans\n';
      for (const p of plans.slice(0, 5)) { text += `- **${p.id}** [${p.status}]: ${p.title}\n`; }
      text += '\n';
    }

    if (lessons.length > 0) {
      text += '## Critical Rules (from lessons)\n';
      for (const l of lessons) { text += `- **${l.id}**: ${l.title}\n`; }
      text += '\n';
    }

    const today = new Date().toISOString().split('T')[0];
    text += `---\n*Auto-generated ${today} from ${entries.length} brain entries. Add \`<!-- manual -->\` to override.*\n`;
    return text;
  }

  async generateAndSave() {
    const shouldRegenerate = await this.needsRegeneration();
    if (!shouldRegenerate) return null;
    const text = await this.generate();
    await writeFile(join(this.manager.brainPath, 'overview.md'), text, 'utf-8');
    return text;
  }
}
