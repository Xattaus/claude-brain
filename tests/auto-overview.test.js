import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutoOverview } from '../lib/auto-overview.js';
import { BrainManager } from '../lib/brain-manager.js';

describe('AutoOverview — tech stack detection', () => {
  it('detects Rust from .rs files', () => {
    const files = ['src/main.rs', 'src/lib.rs', 'src/bot.rs'];
    const stack = AutoOverview.detectTechStack(files);
    assert.ok(stack.includes('Rust'));
  });

  it('detects TypeScript/React from .tsx files', () => {
    const files = ['src/App.tsx', 'src/components/Foo.tsx'];
    const stack = AutoOverview.detectTechStack(files);
    assert.ok(stack.includes('TypeScript/React'));
  });

  it('detects multiple technologies', () => {
    const files = ['src/main.rs', 'web/App.tsx', 'db/schema.sql'];
    const stack = AutoOverview.detectTechStack(files);
    assert.ok(stack.length >= 2);
  });
});

describe('AutoOverview — generation', () => {
  let tempDir, manager, overview;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'overview-test-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'TestProject',
      overview: '# TestProject\n\n> Projekti\n',
      paths: [{ path: tempDir, label: 'root' }]
    });

    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Use SQLite for storage',
      frontmatter: { status: 'active', tags: ['database'], files: ['src/database.rs'], related: [] },
      body: '## Context\nNeed a database.\n\n## Decision\nUse SQLite.\n'
    });
    await manager.createEntry({
      type: 'implementation', prefix: 'IMPL', dirName: 'implementations',
      title: 'User authentication system',
      frontmatter: { status: 'current', tags: ['auth'], files: ['src/auth.rs', 'web/Login.tsx'], related: [] },
      body: '## Description\nJWT-based auth.\n'
    });
    await manager.createEntry({
      type: 'lesson', prefix: 'LES', dirName: 'lessons',
      title: 'Always validate input',
      frontmatter: { status: 'active', severity: 'high', trigger: 'bug', tags: ['security'], files: [], related: [] },
      body: '## What happened\nSQL injection.\n\n## Lesson\nValidate everything.\n\n## Rule\nNever trust user input.\n'
    });

    overview = new AutoOverview(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('generates overview with project name', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('# TestProject'));
  });

  it('includes tech stack section', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('## Tech Stack'));
    assert.ok(text.includes('Rust'));
    assert.ok(text.includes('TypeScript/React'));
  });

  it('includes critical rules from lessons', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('Always validate input'));
  });

  it('includes auto-generated marker', async () => {
    const text = await overview.generate();
    assert.ok(text.includes('Auto-generated'));
  });
});

describe('AutoOverview — staleness check', () => {
  let tempDir, manager, overview;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'stale-test-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'StaleTest',
      overview: '# StaleTest\n\n> Projekti\n',
      paths: [{ path: tempDir, label: 'root' }]
    });
    overview = new AutoOverview(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('considers empty overview as needing regeneration', async () => {
    const needs = await overview.needsRegeneration();
    assert.equal(needs, true);
  });

  it('respects manual override tag', async () => {
    await writeFile(join(tempDir, '.brain', 'overview.md'),
      '<!-- manual -->\n# My Custom Overview\n\nHand-written content.');
    const needs = await overview.needsRegeneration();
    assert.equal(needs, false);
  });
});
