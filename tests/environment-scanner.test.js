import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EnvironmentScanner } from '../lib/integrations/environment-scanner.js';

describe('EnvironmentScanner — MCP servers', () => {
  let tempDir, scanner;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'env-scan-'));
    await mkdir(join(tempDir, '.claude'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: {
        brain: { command: 'node', args: ['mcp-server.js'] },
        playwright: { command: 'npx', args: ['@anthropic/mcp-playwright'] }
      }
    }));
    scanner = new EnvironmentScanner(tempDir);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('discovers MCP servers from settings.json', async () => {
    const env = await scanner.scanMcpServers(join(tempDir, '.claude', 'settings.json'));
    assert.equal(env.length, 2);
    assert.ok(env.some(s => s.name === 'brain'));
    assert.ok(env.some(s => s.name === 'playwright'));
  });
});

describe('EnvironmentScanner — custom agents', () => {
  let tempDir, scanner;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'env-agents-'));
    await mkdir(join(tempDir, '.claude', 'agents'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'agents', 'code-reviewer.md'),
      '---\ndescription: Reviews code for quality\n---\nYou are a code reviewer.');
    await writeFile(join(tempDir, '.claude', 'agents', 'architect.md'),
      '---\ndescription: Designs systems\n---\nYou are an architect.');
    scanner = new EnvironmentScanner(tempDir);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('discovers custom agent files', async () => {
    const agents = await scanner.scanCustomAgents();
    assert.equal(agents.length, 2);
    assert.ok(agents.some(a => a.name === 'code-reviewer'));
    assert.ok(agents.some(a => a.description === 'Designs systems'));
  });
});

describe('EnvironmentScanner — full scan', () => {
  let tempDir, scanner;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'env-full-'));
    await mkdir(join(tempDir, '.claude'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: { brain: { command: 'node', args: ['mcp-server.js'] } }
    }));
    scanner = new EnvironmentScanner(tempDir);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('produces complete environment report', async () => {
    const env = await scanner.scan();
    assert.equal(env.version, 1);
    assert.ok(env.scanned);
    assert.ok(Array.isArray(env.mcp_servers));
    assert.ok(Array.isArray(env.custom_agents));
    assert.ok(Array.isArray(env.skills));
  });
});
