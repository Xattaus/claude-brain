import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

export class SuperpowersSync {
  constructor(manager) {
    this.manager = manager;
  }

  static parseSpecFile(content, filename) {
    const title = extractTitle(content, filename);
    const date = extractDate(filename);
    const summary = extractSummary(content);
    const files = extractFilePaths(content);
    return { title, date, summary, files, tags: ['source:superpowers-spec'] };
  }

  static parsePlanFile(content, filename) {
    const title = extractTitle(content, filename);
    const date = extractDate(filename);
    const summary = extractSummary(content);
    const files = extractFilePaths(content);
    const status = inferPlanStatus(content);
    return { title, date, summary, files, status, tags: ['source:superpowers-plan'] };
  }

  async scanDirectory(dirPath) {
    if (!existsSync(dirPath)) return [];
    const files = await readdir(dirPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    const results = [];
    for (const file of mdFiles) {
      const fullPath = join(dirPath, file);
      const content = await readFile(fullPath, 'utf-8');
      const hash = createHash('md5').update(content).digest('hex');
      results.push({ file, fullPath, content, hash });
    }
    return results;
  }

  async sync(syncState) {
    const projectPath = this.manager.projectPath;
    const specsDir = join(projectPath, 'docs', 'superpowers', 'specs');
    const plansDir = join(projectPath, 'docs', 'superpowers', 'plans');
    const results = { created: 0, updated: 0, unchanged: 0 };

    const specFiles = await this.scanDirectory(specsDir);
    for (const { file, content, hash } of specFiles) {
      const existing = syncState.sources['superpowers-specs']?.files?.[file];
      if (existing && existing.hash === hash) { results.unchanged++; continue; }
      const parsed = SuperpowersSync.parseSpecFile(content, file);
      if (existing?.brainId) {
        try {
          const body = `## Source\n\nSuperpowers spec: \`docs/superpowers/specs/${file}\`\n\n## Summary\n\n${parsed.summary}\n`;
          await this.manager.updateEntry(existing.brainId, { content: body });
          existing.hash = hash;
          existing.syncedAt = new Date().toISOString();
          results.updated++;
        } catch {
          // If update fails, don't update hash — will retry next sync
          results.unchanged++;
        }
      } else {
        const entry = await this.manager.createEntry({
          type: 'plan', prefix: 'PLAN', dirName: 'plans', title: parsed.title,
          frontmatter: { status: 'active', priority: 'medium', tags: parsed.tags, files: parsed.files, related: [], source_file: `docs/superpowers/specs/${file}` },
          body: `## Source\n\nSuperpowers spec: \`docs/superpowers/specs/${file}\`\n\n## Summary\n\n${parsed.summary}\n`
        });
        syncState.sources['superpowers-specs'] = syncState.sources['superpowers-specs'] || { files: {} };
        syncState.sources['superpowers-specs'].files[file] = { hash, brainId: entry.id, syncedAt: new Date().toISOString() };
        results.created++;
      }
    }

    const planFiles = await this.scanDirectory(plansDir);
    for (const { file, content, hash } of planFiles) {
      const existing = syncState.sources['superpowers-plans']?.files?.[file];
      if (existing && existing.hash === hash) { results.unchanged++; continue; }
      const parsed = SuperpowersSync.parsePlanFile(content, file);
      if (existing?.brainId) {
        try {
          const body = `## Source\n\nSuperpowers plan: \`docs/superpowers/plans/${file}\`\n\n## Summary\n\n${parsed.summary}\n`;
          await this.manager.updateEntry(existing.brainId, { content: body, status: parsed.status });
          existing.hash = hash;
          existing.syncedAt = new Date().toISOString();
          results.updated++;
        } catch {
          // If update fails, don't update hash — will retry next sync
          results.unchanged++;
        }
      } else {
        const entry = await this.manager.createEntry({
          type: 'plan', prefix: 'PLAN', dirName: 'plans', title: parsed.title,
          frontmatter: { status: parsed.status, priority: 'medium', tags: parsed.tags, files: parsed.files, related: [], source_file: `docs/superpowers/plans/${file}` },
          body: `## Source\n\nSuperpowers plan: \`docs/superpowers/plans/${file}\`\n\n## Summary\n\n${parsed.summary}\n`
        });
        syncState.sources['superpowers-plans'] = syncState.sources['superpowers-plans'] || { files: {} };
        syncState.sources['superpowers-plans'].files[file] = { hash, brainId: entry.id, syncedAt: new Date().toISOString() };
        results.created++;
      }
    }
    return results;
  }
}

function extractTitle(content, filename) {
  const headingMatch = content.match(/^# (.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  const base = filename.replace(/\.md$/, '');
  return base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function extractDate(filename) {
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];
}

function extractSummary(content) {
  const withoutTitle = content.replace(/^# .+\n+/, '');
  const withoutBoilerplate = withoutTitle
    .replace(/^>.*\n+/gm, '')
    .replace(/^\*\*Goal:\*\*.*\n+/gm, '')
    .replace(/^\*\*Architecture:\*\*.*\n+/gm, '')
    .replace(/^\*\*Tech Stack:\*\*.*\n+/gm, '')
    .replace(/^---\n+/gm, '');
  const paragraphs = withoutBoilerplate.split(/\n\n+/).filter(p => p.trim().length > 0);
  let summary = '';
  for (const p of paragraphs) {
    if (summary.length + p.length > 500) break;
    summary += (summary ? '\n\n' : '') + p.trim();
  }
  return summary || withoutBoilerplate.substring(0, 500).trim();
}

function extractFilePaths(content) {
  const paths = [];
  const pathRegex = /`([a-zA-Z][\w\-./]*\.[a-zA-Z]{1,10})`/g;
  let match;
  while ((match = pathRegex.exec(content)) !== null) {
    const p = match[1];
    if (p.includes('/') && !p.startsWith('http')) paths.push(p);
  }
  return [...new Set(paths)];
}

function inferPlanStatus(content) {
  const checkedCount = (content.match(/- \[x\]/gi) || []).length;
  const uncheckedCount = (content.match(/- \[ \]/g) || []).length;
  const total = checkedCount + uncheckedCount;
  if (total === 0) return 'planned';
  if (uncheckedCount === 0) return 'completed';
  if (checkedCount === 0) return 'planned';
  return 'partial';
}
