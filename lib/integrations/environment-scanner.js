import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export class EnvironmentScanner {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.homeDir = homedir();
  }

  async scanMcpServers(settingsPath) {
    if (!existsSync(settingsPath)) return [];
    try {
      const data = JSON.parse(await readFile(settingsPath, 'utf-8'));
      const servers = data.mcpServers || {};
      return Object.entries(servers).map(([name, config]) => ({
        name,
        command: config.command || '',
        args: config.args || []
      }));
    } catch {
      return [];
    }
  }

  async scanCustomAgents() {
    const agentsDir = join(this.projectPath, '.claude', 'agents');
    if (!existsSync(agentsDir)) return [];
    try {
      const files = await readdir(agentsDir);
      const agents = [];
      for (const file of files.filter(f => f.endsWith('.md'))) {
        const content = await readFile(join(agentsDir, file), 'utf-8');
        const descMatch = content.match(/description:\s*(.+)/);
        agents.push({
          name: basename(file, '.md'),
          file: `.claude/agents/${file}`,
          description: descMatch ? descMatch[1].trim() : ''
        });
      }
      return agents;
    } catch {
      return [];
    }
  }

  async scanSkills() {
    const pluginBase = join(this.homeDir, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers');
    if (!existsSync(pluginBase)) return [];
    try {
      const versions = await readdir(pluginBase);
      if (versions.length === 0) return [];
      const latestVersion = versions.sort().pop();
      const skillsDir = join(pluginBase, latestVersion, 'skills');
      if (!existsSync(skillsDir)) return [];
      const skillDirs = await readdir(skillsDir);
      const skills = [];
      for (const dir of skillDirs) {
        const indexPath = join(skillsDir, dir, 'SKILL.md');
        let description = '';
        if (existsSync(indexPath)) {
          const content = await readFile(indexPath, 'utf-8');
          const descMatch = content.match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
        }
        skills.push({ name: dir, description });
      }
      return skills;
    } catch {
      return [];
    }
  }

  async scan() {
    const projectSettings = join(this.projectPath, '.claude', 'settings.json');
    const userSettings = join(this.homeDir, '.claude', 'settings.json');
    const settingsPath = existsSync(projectSettings) ? projectSettings : userSettings;
    const mcpServers = await this.scanMcpServers(settingsPath);
    const customAgents = await this.scanCustomAgents();
    const skills = await this.scanSkills();
    return {
      version: 1,
      scanned: new Date().toISOString(),
      mcp_servers: mcpServers,
      custom_agents: customAgents,
      skills
    };
  }

  async scanAndSave(brainPath) {
    const env = await this.scan();
    await writeFile(join(brainPath, 'environment.json'), JSON.stringify(env, null, 2), 'utf-8');
    return env;
  }
}
