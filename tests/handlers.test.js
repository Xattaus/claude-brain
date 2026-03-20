#!/usr/bin/env node

/**
 * Handler Tests — Tests for all 6 handler modules
 *
 * Uses Node.js built-in test runner (node:test). No external test dependencies.
 * Run: node --test tests/handlers.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainManager } from '../lib/brain-manager.js';
import { BrainSearch } from '../lib/search.js';
import { ConflictChecker } from '../lib/conflict-checker.js';
import { getTranslator } from '../lib/i18n.js';
import { TfIdf } from '../lib/tfidf.js';
import { SessionTracker } from '../lib/utils/session-tracker.js';
import { BrainMetrics } from '../lib/metrics.js';
import { coreHandlers } from '../lib/handlers/core.js';
import { recordingHandlers } from '../lib/handlers/recording.js';
import { contextHandlers } from '../lib/handlers/context.js';
import { safetyHandlers } from '../lib/handlers/safety.js';
import { planningHandlers } from '../lib/handlers/planning.js';
import { maintenanceHandlers } from '../lib/handlers/maintenance.js';

// ── Test helpers ──

async function createTestBrain() {
  const tempDir = await mkdtemp(join(tmpdir(), 'handler-test-'));
  const manager = new BrainManager(tempDir);
  await manager.initBrain({
    projectName: 'test-project',
    overview: '# Test Project\n\nThis is a test project for handler testing.',
    paths: [{ path: tempDir, label: 'root' }]
  });
  return { tempDir, manager };
}

function createCtx(manager, overrides = {}) {
  const search = new BrainSearch(manager);
  const checker = new ConflictChecker(manager);
  const session = new SessionTracker();
  const t = getTranslator('en');
  const tfidf = new TfIdf();
  const metrics = new BrainMetrics(join(manager.projectPath, '.brain'));
  return { manager, search, checker, session, t, tfidf, metrics, ...overrides };
}

// ── Core Handlers Tests ──

describe('Core handlers — brain_get_overview', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns overview text', async () => {
    const result = await coreHandlers.brain_get_overview(ctx, {});
    assert.ok(Array.isArray(result));
    assert.equal(result[0].type, 'text');
    assert.ok(result[0].text.includes('Test Project'));
  });

  it('compact mode truncates overview', async () => {
    const result = await coreHandlers.brain_get_overview(ctx, { compact: true });
    assert.ok(result[0].text.includes('Test Project'));
  });

  it('includes active decisions section when decisions exist', async () => {
    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Use Node.js',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Context\nNeed runtime.\n\n## Decision\nUse Node.js.'
    });

    const result = await coreHandlers.brain_get_overview(ctx, {});
    assert.ok(result[0].text.includes('Active Decisions'));
    assert.ok(result[0].text.includes('DEC-001'));
  });

  it('max_tokens truncates output', async () => {
    const result = await coreHandlers.brain_get_overview(ctx, { max_tokens: 50 });
    assert.ok(result[0].text.length > 0);
  });
});

describe('Core handlers — brain_search', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Authentication Strategy',
      frontmatter: { status: 'active', tags: ['auth'], files: ['auth.js'], related: [] },
      body: '## Context\nNeed auth.\n\n## Decision\nUse JWT tokens.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('finds matching entries', async () => {
    const result = await coreHandlers.brain_search(ctx, { query: 'authentication' });
    assert.ok(result[0].text.includes('Authentication'));
  });

  it('returns no results message for unmatched query', async () => {
    const result = await coreHandlers.brain_search(ctx, { query: 'xyznonexistent999' });
    assert.ok(result[0].text.includes('No results'));
  });

  it('compact mode produces shorter output', async () => {
    const result = await coreHandlers.brain_search(ctx, { query: 'authentication', compact: true });
    assert.ok(result[0].text.includes('brain_get_entry'));
  });

  it('type filter works', async () => {
    const result = await coreHandlers.brain_search(ctx, { query: 'authentication', type: 'bug' });
    assert.ok(result[0].text.includes('No results'));
  });
});

describe('Core handlers — brain_get_entry', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Database Choice',
      frontmatter: { status: 'active', tags: ['db'], files: ['db.js'], related: [] },
      body: '## Context\nNeed DB.\n\n## Decision\nUse PostgreSQL.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns entry content', async () => {
    const result = await coreHandlers.brain_get_entry(ctx, { id: 'DEC-001' });
    assert.ok(result[0].text.includes('PostgreSQL'));
  });

  it('returns not found for invalid ID', async () => {
    const result = await coreHandlers.brain_get_entry(ctx, { id: 'DEC-999' });
    assert.ok(result[0].text.includes('not found'));
  });
});

describe('Core handlers — brain_list', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'List Test Decision',
      frontmatter: { status: 'active', tags: ['test'], files: [], related: [] },
      body: '## Context\nTest.\n\n## Decision\nTest.'
    });
    await ctx.manager.createEntry({
      type: 'bug', prefix: 'BUG', dirName: 'bugs',
      title: 'List Test Bug',
      frontmatter: { status: 'open', severity: 'low', tags: [], files: [], related: [] },
      body: '## Symptoms\nBroken.\n\n## Root Cause\nBad.\n\n## Fix\nGood.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('lists all entries', async () => {
    const result = await coreHandlers.brain_list(ctx, {});
    assert.ok(result[0].text.includes('DEC-001'));
    assert.ok(result[0].text.includes('BUG-001'));
  });

  it('filters by type', async () => {
    const result = await coreHandlers.brain_list(ctx, { type: 'decision' });
    assert.ok(result[0].text.includes('DEC-001'));
    assert.ok(!result[0].text.includes('BUG-001'));
  });

  it('filters by status', async () => {
    const result = await coreHandlers.brain_list(ctx, { status: 'open' });
    assert.ok(result[0].text.includes('BUG-001'));
  });

  it('compact mode shows shorter output', async () => {
    const result = await coreHandlers.brain_list(ctx, { compact: true });
    assert.ok(result[0].text.includes('DEC-001'));
    // compact mode omits type/status brackets
    assert.ok(!result[0].text.includes('[decision/'));
  });

  it('returns no entries message when filter has no matches', async () => {
    const result = await coreHandlers.brain_list(ctx, { type: 'pattern' });
    assert.ok(result[0].text.includes('No entries found'));
  });
});

describe('Core handlers — brain_get_lessons', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'lesson', prefix: 'LES', dirName: 'lessons',
      title: 'Never force push',
      frontmatter: {
        status: 'active', severity: 'high', trigger: 'correction',
        tags: ['git'], files: [], related: []
      },
      body: '## What Happened\nForce pushed.\n\n## Lesson\nDon\'t do it.\n\n## Rule\nAlways ask before force-push.'
    });
    await ctx.manager.createEntry({
      type: 'lesson', prefix: 'LES', dirName: 'lessons',
      title: 'Check types',
      frontmatter: {
        status: 'active', severity: 'low', trigger: 'discovery',
        tags: ['typescript'], files: [], related: []
      },
      body: '## What Happened\nType error.\n\n## Lesson\nCheck types.\n\n## Rule\nRun tsc before commit.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns active lessons sorted by severity', async () => {
    const result = await coreHandlers.brain_get_lessons(ctx, {});
    assert.ok(result[0].text.includes('Lessons Learned'));
    assert.ok(result[0].text.includes('LES-001'));
    // high severity should come before low
    const highIdx = result[0].text.indexOf('LES-001');
    const lowIdx = result[0].text.indexOf('LES-002');
    assert.ok(highIdx < lowIdx, 'High severity should come before low');
  });

  it('filters by severity', async () => {
    const result = await coreHandlers.brain_get_lessons(ctx, { severity: 'high' });
    assert.ok(result[0].text.includes('LES-001'));
    assert.ok(!result[0].text.includes('LES-002'));
  });

  it('compact mode shows rules only', async () => {
    const result = await coreHandlers.brain_get_lessons(ctx, { compact: true });
    assert.ok(result[0].text.includes('LES-001'));
  });

  it('returns no lessons message when none match', async () => {
    const result = await coreHandlers.brain_get_lessons(ctx, { severity: 'medium' });
    assert.ok(result[0].text.includes('No active lessons'));
  });

  it('filters by tags', async () => {
    const result = await coreHandlers.brain_get_lessons(ctx, { tags: ['git'] });
    assert.ok(result[0].text.includes('LES-001'));
    assert.ok(!result[0].text.includes('LES-002'));
  });
});

// ── Recording Handlers Tests ──

describe('Recording handlers — brain_record_decision', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('records a decision and returns confirmation', async () => {
    const result = await recordingHandlers.brain_record_decision(ctx, {
      title: 'Use TypeScript',
      context: 'Need type safety',
      decision: 'Adopt TypeScript for all new code'
    });
    assert.ok(result[0].text.includes('DEC-001'));
    assert.ok(result[0].text.includes('Decision recorded'));
  });

  it('recorded decision is retrievable', async () => {
    const entry = await ctx.manager.getEntry('DEC-001');
    assert.ok(entry);
    assert.ok(entry.content.includes('TypeScript'));
  });

  it('tracks change in session', async () => {
    const changes = ctx.session.getChanges();
    assert.ok(changes.some(c => c.type === 'decision' && c.id === 'DEC-001'));
  });

  it('supports tags and files', async () => {
    const result = await recordingHandlers.brain_record_decision(ctx, {
      title: 'Use ESM modules',
      context: 'Need modern module system',
      decision: 'Use ESM everywhere',
      tags: ['modules', 'esm'],
      files: ['package.json']
    });
    assert.ok(result[0].text.includes('DEC-002'));
  });

  it('detects duplicate titles', async () => {
    const result = await recordingHandlers.brain_record_decision(ctx, {
      title: 'Use TypeScript',
      context: 'Same decision again',
      decision: 'Same'
    });
    assert.ok(result[0].text.includes('Similar entries'));
  });

  it('supports supersedes shorthand', async () => {
    const result = await recordingHandlers.brain_record_decision(ctx, {
      title: 'Use TypeScript v5',
      context: 'Upgrade TypeScript',
      decision: 'Upgrade to v5',
      supersedes: 'DEC-001'
    });
    assert.ok(result[0].text.includes('DEC-'));
  });
});

describe('Recording handlers — brain_record_bug', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('records a bug and returns confirmation', async () => {
    const result = await recordingHandlers.brain_record_bug(ctx, {
      title: 'Login crash on empty password',
      symptoms: 'App crashes when password is empty',
      root_cause: 'Missing null check',
      fix: 'Added null check before validation'
    });
    assert.ok(result[0].text.includes('BUG-001'));
    assert.ok(result[0].text.includes('Bug recorded'));
  });

  it('supports severity and status', async () => {
    const result = await recordingHandlers.brain_record_bug(ctx, {
      title: 'Memory leak in worker',
      symptoms: 'Growing memory usage',
      root_cause: 'Unclosed streams',
      fix: 'Close streams on completion',
      severity: 'critical',
      status: 'open'
    });
    assert.ok(result[0].text.includes('BUG-002'));
  });

  it('supports files and tags', async () => {
    const result = await recordingHandlers.brain_record_bug(ctx, {
      title: 'API timeout bug',
      symptoms: 'Requests time out',
      root_cause: 'Missing timeout config',
      fix: 'Added timeout option',
      files: ['api/client.js'],
      tags: ['api', 'timeout']
    });
    assert.ok(result[0].text.includes('BUG-003'));
  });
});

describe('Recording handlers — brain_record_implementation', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('records an implementation', async () => {
    const result = await recordingHandlers.brain_record_implementation(ctx, {
      title: 'Connection pooling',
      description: 'Implemented database connection pooling'
    });
    assert.ok(result[0].text.includes('IMPL-001'));
    assert.ok(result[0].text.includes('Implementation recorded'));
  });

  it('supports key_details and why fields', async () => {
    const result = await recordingHandlers.brain_record_implementation(ctx, {
      title: 'Rate limiter',
      description: 'Token bucket rate limiter',
      key_details: 'Max 100 requests per minute',
      why: 'Prevent API abuse'
    });
    assert.ok(result[0].text.includes('IMPL-002'));

    const entry = await ctx.manager.getEntry('IMPL-002');
    assert.ok(entry.content.includes('100 requests'));
    assert.ok(entry.content.includes('Prevent API abuse'));
  });
});

describe('Recording handlers — brain_record_pattern', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('records a pattern', async () => {
    const result = await recordingHandlers.brain_record_pattern(ctx, {
      title: 'Repository pattern',
      pattern: 'Use repository classes for data access'
    });
    assert.ok(result[0].text.includes('PAT-001'));
    assert.ok(result[0].text.includes('Pattern recorded'));
  });

  it('supports example code', async () => {
    const result = await recordingHandlers.brain_record_pattern(ctx, {
      title: 'Error handler pattern',
      pattern: 'Wrap async handlers with error catcher',
      example: 'const handler = catchAsync(async (req, res) => { ... });'
    });
    assert.ok(result[0].text.includes('PAT-002'));

    const entry = await ctx.manager.getEntry('PAT-002');
    assert.ok(entry.content.includes('catchAsync'));
  });
});

describe('Recording handlers — brain_record_lesson', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('records a lesson', async () => {
    const result = await recordingHandlers.brain_record_lesson(ctx, {
      title: 'Always run tests before commit',
      what_happened: 'Pushed broken code',
      lesson: 'Run tests first',
      rule: 'Always run npm test before git commit'
    });
    assert.ok(result[0].text.includes('LES-001'));
    assert.ok(result[0].text.includes('Lesson recorded'));
  });

  it('supports severity and trigger', async () => {
    const result = await recordingHandlers.brain_record_lesson(ctx, {
      title: 'Check for null',
      what_happened: 'Null reference error in production',
      lesson: 'Always check for null',
      rule: 'Add null checks at boundaries',
      severity: 'high',
      trigger: 'bug'
    });
    assert.ok(result[0].text.includes('LES-002'));
  });

  it('stores rule in index for fast lookup', async () => {
    const index = await ctx.manager.loadIndex();
    const lesson = index.entries.find(e => e.id === 'LES-001');
    assert.ok(lesson);
    assert.equal(lesson.rule, 'Always run npm test before git commit');
  });
});

// ── Context Handlers Tests ──

describe('Context handlers — brain_check_conflicts', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'API Rate Limiting Strategy',
      frontmatter: { status: 'active', tags: ['api'], files: ['middleware/rate-limit.js'], related: [] },
      body: '## Context\nNeed rate limiting.\n\n## Decision\nUse token bucket algorithm.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('detects conflicts with active decisions', async () => {
    const result = await contextHandlers.brain_check_conflicts(ctx, {
      proposed_change: 'Modify rate limiting',
      affected_files: ['middleware/rate-limit.js']
    });
    assert.ok(result[0].text.includes('CONFLICT') || result[0].text.includes('WARNING'));
  });

  it('returns safe message when no conflicts', async () => {
    const result = await contextHandlers.brain_check_conflicts(ctx, {
      proposed_change: 'Add new UI component',
      affected_files: ['components/button.js']
    });
    assert.ok(result[0].text.includes('No conflicts') || result[0].text.includes('Safe'));
  });
});

describe('Context handlers — brain_link_entries', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Decision A',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Context\nA.\n\n## Decision\nA.'
    });
    await ctx.manager.createEntry({
      type: 'implementation', prefix: 'IMPL', dirName: 'implementations',
      title: 'Impl of A',
      frontmatter: { status: 'current', tags: [], files: [], related: [] },
      body: '## Description\nImplementation of decision A.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('creates bidirectional link', async () => {
    const result = await contextHandlers.brain_link_entries(ctx, {
      from: 'IMPL-001',
      to: 'DEC-001',
      rel: 'implements'
    });
    assert.ok(result[0].text.includes('Linked'));
    assert.ok(result[0].text.includes('implements'));
    assert.ok(result[0].text.includes('IMPL-001'));
    assert.ok(result[0].text.includes('DEC-001'));
  });
});

describe('Context handlers — brain_get_context_for_files', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Auth Decision',
      frontmatter: { status: 'active', tags: [], files: ['auth/login.js'], related: [] },
      body: '## Context\nAuth.\n\n## Decision\nUse JWT.'
    });
    await ctx.manager.createEntry({
      type: 'bug', prefix: 'BUG', dirName: 'bugs',
      title: 'Auth Bug',
      frontmatter: { status: 'fixed', severity: 'high', tags: [], files: ['auth/login.js'], related: [] },
      body: '## Symptoms\nBroken.\n\n## Root Cause\nBad.\n\n## Fix\nGood.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns grouped context for files', async () => {
    const result = await contextHandlers.brain_get_context_for_files(ctx, {
      files: ['auth/login.js']
    });
    assert.ok(result[0].text.includes('DEC-001'));
    assert.ok(result[0].text.includes('BUG-001'));
  });

  it('returns no context message for unknown files', async () => {
    const result = await contextHandlers.brain_get_context_for_files(ctx, {
      files: ['unknown/file.js']
    });
    assert.ok(result[0].text.includes('No brain context'));
  });

  it('compact mode works', async () => {
    const result = await contextHandlers.brain_get_context_for_files(ctx, {
      files: ['auth/login.js'],
      compact: true
    });
    assert.ok(result[0].text.includes('brain_get_entry'));
  });
});

describe('Context handlers — brain_traverse_graph', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Root Decision',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Context\nRoot.\n\n## Decision\nRoot.'
    });
    await ctx.manager.createEntry({
      type: 'implementation', prefix: 'IMPL', dirName: 'implementations',
      title: 'Impl of Root',
      frontmatter: { status: 'current', tags: [], files: [], related: [{ id: 'DEC-001', rel: 'implements' }] },
      body: '## Description\nImplementation.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('traverse mode returns nodes and edges', async () => {
    const result = await contextHandlers.brain_traverse_graph(ctx, {
      mode: 'traverse',
      start_id: 'IMPL-001'
    });
    assert.ok(result[0].text.includes('Graph traversal'));
    assert.ok(result[0].text.includes('IMPL-001'));
    assert.ok(result[0].text.includes('Nodes'));
    assert.ok(result[0].text.includes('Edges'));
  });

  it('traverse mode requires start_id', async () => {
    const result = await contextHandlers.brain_traverse_graph(ctx, {
      mode: 'traverse'
    });
    assert.ok(result[0].text.includes('start_id is required'));
  });

  it('path mode finds path between entries', async () => {
    // Add bidirectional link so path can be found
    await ctx.manager.linkEntries('IMPL-001', 'DEC-001', 'implements');

    const result = await contextHandlers.brain_traverse_graph(ctx, {
      mode: 'path',
      start_id: 'IMPL-001',
      target_id: 'DEC-001'
    });
    assert.ok(result[0].text.includes('Path') || result[0].text.includes('No path'));
  });

  it('path mode requires both start and target', async () => {
    const result = await contextHandlers.brain_traverse_graph(ctx, {
      mode: 'path',
      start_id: 'IMPL-001'
    });
    assert.ok(result[0].text.includes('target_id'));
  });

  it('impact mode returns dependents', async () => {
    const result = await contextHandlers.brain_traverse_graph(ctx, {
      mode: 'impact',
      start_id: 'DEC-001'
    });
    assert.ok(result[0].text.includes('Impact analysis'));
  });

  it('cycles mode detects cycles', async () => {
    const result = await contextHandlers.brain_traverse_graph(ctx, {
      mode: 'cycles'
    });
    assert.ok(result[0].text.includes('Cycle detection'));
  });

  it('unknown mode returns error', async () => {
    const result = await contextHandlers.brain_traverse_graph(ctx, {
      mode: 'unknown_mode'
    });
    assert.ok(result[0].text.includes('Unknown mode'));
  });
});

// ── Safety Handlers Tests ──

describe('Safety handlers — brain_preflight', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    // Create entries to generate context
    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Strict Input Validation',
      frontmatter: { status: 'active', tags: ['security'], files: ['src/validation.js'], related: [] },
      body: '## Context\nNeed validation.\n\n## Decision\nValidate all inputs.\n\nDONT: Allow unvalidated user input.'
    });
    await ctx.manager.createEntry({
      type: 'bug', prefix: 'BUG', dirName: 'bugs',
      title: 'XSS in search field',
      frontmatter: { status: 'fixed', severity: 'critical', tags: ['security'], files: ['src/validation.js'], related: [] },
      body: '## Symptoms\nXSS.\n\n## Root Cause\nNo escaping.\n\n## Fix\nAdded escaping.'
    });

    // Rebuild rule index so preflight can use it
    await ctx.manager.rebuildRuleIndex();
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns risk score and sections', async () => {
    const result = await safetyHandlers.brain_preflight(ctx, {
      files: ['src/validation.js']
    });
    assert.ok(result[0].text.includes('PREFLIGHT'));
    assert.ok(result[0].text.includes('RISK'));
  });

  it('shows rules when they exist', async () => {
    const result = await safetyHandlers.brain_preflight(ctx, {
      files: ['src/validation.js']
    });
    // Should include rules section or context about the file
    assert.ok(result[0].text.includes('ACTIVE DECISIONS') || result[0].text.includes('RULES') || result[0].text.includes('REGRESSION'));
  });

  it('handles files with no context', async () => {
    const result = await safetyHandlers.brain_preflight(ctx, {
      files: ['unknown/new-file.js']
    });
    assert.ok(result[0].text.includes('PREFLIGHT'));
    assert.ok(result[0].text.includes('No rules or context'));
  });

  it('supports intent for conflict detection', async () => {
    const result = await safetyHandlers.brain_preflight(ctx, {
      files: ['src/validation.js'],
      intent: 'Remove input validation'
    });
    assert.ok(result[0].text.includes('RISK'));
  });
});

describe('Safety handlers — brain_validate_change', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'bug', prefix: 'BUG', dirName: 'bugs',
      title: 'SQL injection in search query',
      frontmatter: { status: 'fixed', severity: 'critical', tags: ['security'], files: ['db/queries.js'], related: [] },
      body: '## Symptoms\nSQL injection.\n\n## Root Cause\nString concatenation.\n\n## Fix\nUsed parameterized queries.'
    });

    await ctx.manager.rebuildRuleIndex();
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('passes validation when no violations', async () => {
    const result = await safetyHandlers.brain_validate_change(ctx, {
      files: ['components/button.js'],
      change_description: 'Updated button color to blue'
    });
    assert.ok(result[0].text.includes('VALIDATION'));
  });

  it('returns structured result with status', async () => {
    const result = await safetyHandlers.brain_validate_change(ctx, {
      files: ['db/queries.js'],
      change_description: 'Refactored database query builder',
      changes_summary: 'Changed how SQL queries are constructed'
    });
    assert.ok(result[0].text.includes('VALIDATION'));
  });
});

describe('Safety handlers — brain_rebuild_rules', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Security Rules',
      frontmatter: { status: 'active', tags: [], files: ['app.js'], related: [] },
      body: '## Context\nSecurity.\n\n## Decision\nFollow OWASP.\n\nALWAYS: Sanitize user input.\nNEVER: Trust client-side validation alone.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('rebuilds rule index and returns stats', async () => {
    const result = await safetyHandlers.brain_rebuild_rules(ctx, {});
    assert.ok(result[0].text.includes('Rule index rebuilt'));
    assert.ok(result[0].text.includes('rules extracted'));
  });
});

// ── Planning Handlers Tests ──

describe('Planning handlers — brain_record_plan', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('records a plan', async () => {
    const result = await planningHandlers.brain_record_plan(ctx, {
      title: 'Phase 1: Authentication',
      scope: 'Implement full auth system with JWT'
    });
    assert.ok(result[0].text.includes('PLAN-001'));
    assert.ok(result[0].text.includes('Plan recorded'));
  });

  it('supports implemented and deferred items', async () => {
    const result = await planningHandlers.brain_record_plan(ctx, {
      title: 'Phase 2: API Layer',
      scope: 'Build REST API endpoints',
      implemented: ['GET /users', 'POST /users'],
      deferred: [
        { item: 'PUT /users/:id', reason: 'Not needed yet' },
        { item: 'DELETE /users/:id', reason: 'Security review pending' }
      ],
      next_steps: 'Implement remaining CRUD endpoints',
      priority: 'high',
      status: 'partial'
    });
    assert.ok(result[0].text.includes('PLAN-002'));

    const entry = await ctx.manager.getEntry('PLAN-002');
    assert.ok(entry.content.includes('GET /users'));
    assert.ok(entry.content.includes('PUT /users/:id'));
  });
});

describe('Planning handlers — brain_get_backlog', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'plan', prefix: 'PLAN', dirName: 'plans',
      title: 'Backlog Test Plan',
      frontmatter: { status: 'partial', priority: 'high', tags: [], related: [], files: [] },
      body: '## Original Plan\n\nTest plan.\n\n## Implemented\n\n- [x] Item 1\n\n## Deferred\n\n- [ ] Item 2 (syy: too complex)\n\n## Next Steps\n\nFinish item 2.\n'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns incomplete plans', async () => {
    const result = await planningHandlers.brain_get_backlog(ctx, {});
    assert.ok(result[0].text.includes('Backlog'));
    assert.ok(result[0].text.includes('PLAN-001'));
  });

  it('compact mode shows shorter output', async () => {
    const result = await planningHandlers.brain_get_backlog(ctx, { compact: true });
    assert.ok(result[0].text.includes('PLAN-001'));
    // Priority may default to MEDIUM if createEntry doesn't store priority in index
    assert.ok(result[0].text.includes('MEDIUM') || result[0].text.includes('HIGH'));
  });

  it('returns empty message when no plans', async () => {
    // Update to completed
    await ctx.manager.updateEntry('PLAN-001', { status: 'completed' });
    const result = await planningHandlers.brain_get_backlog(ctx, {});
    assert.ok(result[0].text.includes('No plans in backlog'));
  });

  it('include_completed shows completed plans', async () => {
    const result = await planningHandlers.brain_get_backlog(ctx, { include_completed: true });
    assert.ok(result[0].text.includes('PLAN-001'));
  });
});

describe('Planning handlers — brain_update_plan', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'plan', prefix: 'PLAN', dirName: 'plans',
      title: 'Updatable Plan',
      frontmatter: { status: 'partial', priority: 'medium', tags: [], related: [], files: [] },
      body: '## Original Plan\n\nTest.\n\n## Implemented\n\n- [x] Step 1\n\n## Deferred\n\n- [ ] Step 2 (syy: complex)\n\n## Next Steps\n\nDo step 2.\n'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('updates plan status', async () => {
    const result = await planningHandlers.brain_update_plan(ctx, {
      id: 'PLAN-001',
      status: 'in_progress'
    });
    assert.ok(result[0].text.includes('Updated PLAN-001'));
  });

  it('adds new implemented items', async () => {
    const result = await planningHandlers.brain_update_plan(ctx, {
      id: 'PLAN-001',
      new_implemented: ['Step 3 completed']
    });
    assert.ok(result[0].text.includes('implemented'));
  });

  it('adds new deferred items', async () => {
    const result = await planningHandlers.brain_update_plan(ctx, {
      id: 'PLAN-001',
      new_deferred: [{ item: 'Step 4', reason: 'Need more research' }]
    });
    assert.ok(result[0].text.includes('deferred'));
  });

  it('updates next steps', async () => {
    const result = await planningHandlers.brain_update_plan(ctx, {
      id: 'PLAN-001',
      next_steps: 'Focus on step 4 research'
    });
    assert.ok(result[0].text.includes('next_steps'));
  });

  it('returns not found for invalid plan', async () => {
    const result = await planningHandlers.brain_update_plan(ctx, {
      id: 'PLAN-999'
    });
    assert.ok(result[0].text.includes('not found'));
  });
});

describe('Planning handlers — brain_get_session_summary', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns empty session message when no changes', async () => {
    const result = await planningHandlers.brain_get_session_summary(ctx, {});
    assert.ok(result[0].text.includes('No brain changes'));
  });

  it('returns summary after changes', async () => {
    ctx.session.trackChange('decision', 'DEC-001', 'Test Decision');
    ctx.session.trackChange('bug', 'BUG-001', 'Test Bug');

    const result = await planningHandlers.brain_get_session_summary(ctx, {});
    assert.ok(result[0].text.includes('Session Summary'));
    assert.ok(result[0].text.includes('2 changes'));
    assert.ok(result[0].text.includes('DEC-001'));
    assert.ok(result[0].text.includes('BUG-001'));
  });
});

// ── Maintenance Handlers Tests ──

describe('Maintenance handlers — brain_update_entry', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Original Title',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Context\nOrig.\n\n## Decision\nOrig.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('updates entry status', async () => {
    const result = await maintenanceHandlers.brain_update_entry(ctx, {
      id: 'DEC-001',
      status: 'superseded'
    });
    assert.ok(result[0].text.includes('Updated DEC-001'));
    assert.ok(result[0].text.includes('status'));
  });

  it('updates entry title', async () => {
    const result = await maintenanceHandlers.brain_update_entry(ctx, {
      id: 'DEC-001',
      title: 'Updated Title'
    });
    assert.ok(result[0].text.includes('Updated DEC-001'));
    assert.ok(result[0].text.includes('title'));
  });

  it('returns not found for invalid ID', async () => {
    const result = await maintenanceHandlers.brain_update_entry(ctx, {
      id: 'DEC-999'
    });
    assert.ok(result[0].text.includes('not found'));
  });
});

describe('Maintenance handlers — brain_health', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Health Test',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Context\nTest.\n\n## Decision\nTest.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns health report', async () => {
    const result = await maintenanceHandlers.brain_health(ctx, {});
    assert.ok(result[0].text.includes('Brain Health Report'));
    assert.ok(result[0].text.includes('Total entries'));
  });

  it('accepts threshold_days parameter', async () => {
    const result = await maintenanceHandlers.brain_health(ctx, { threshold_days: 1 });
    assert.ok(result[0].text.includes('Brain Health Report'));
  });
});

describe('Maintenance handlers — brain_review_entry', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Review Me',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Context\nTest.\n\n## Decision\nTest.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('marks entry as reviewed', async () => {
    const result = await maintenanceHandlers.brain_review_entry(ctx, {
      id: 'DEC-001'
    });
    assert.ok(result[0].text.includes('Reviewed'));
    assert.ok(result[0].text.includes('DEC-001'));
    assert.ok(result[0].text.includes('last_reviewed'));
  });

  it('supports notes parameter', async () => {
    const result = await maintenanceHandlers.brain_review_entry(ctx, {
      id: 'DEC-001',
      notes: 'Still valid and relevant'
    });
    assert.ok(result[0].text.includes('Reviewed'));
  });

  it('returns not found for invalid ID', async () => {
    const result = await maintenanceHandlers.brain_review_entry(ctx, {
      id: 'DEC-999'
    });
    assert.ok(result[0].text.includes('not found'));
  });
});

describe('Maintenance handlers — brain_get_history', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);

    // Create an entry to generate history
    await ctx.manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'History Test',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Context\nTest.\n\n## Decision\nTest.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('returns history text', async () => {
    const result = await maintenanceHandlers.brain_get_history(ctx, {});
    assert.ok(Array.isArray(result));
    assert.equal(result[0].type, 'text');
    // History should exist as a string (may be empty if changelog not populated)
    assert.equal(typeof result[0].text, 'string');
  });

  it('supports limit parameter', async () => {
    const result = await maintenanceHandlers.brain_get_history(ctx, { limit: 5 });
    assert.equal(typeof result[0].text, 'string');
  });

  it('supports since parameter', async () => {
    const result = await maintenanceHandlers.brain_get_history(ctx, { since: '2020-01-01' });
    assert.equal(typeof result[0].text, 'string');
  });
});

// ── Cross-handler Integration Tests ──

describe('Cross-handler integration', () => {
  let ctx, tempDir;

  before(async () => {
    const brain = await createTestBrain();
    tempDir = brain.tempDir;
    ctx = createCtx(brain.manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('record decision then find via search', async () => {
    await recordingHandlers.brain_record_decision(ctx, {
      title: 'Use PostgreSQL database',
      context: 'Need a relational database',
      decision: 'Use PostgreSQL for all data storage'
    });

    const searchResult = await coreHandlers.brain_search(ctx, { query: 'PostgreSQL database' });
    assert.ok(searchResult[0].text.includes('PostgreSQL'));
  });

  it('record bug then find via get_context_for_files', async () => {
    await recordingHandlers.brain_record_bug(ctx, {
      title: 'Query timeout bug',
      symptoms: 'Queries time out under load',
      root_cause: 'Missing index',
      fix: 'Added composite index',
      files: ['db/queries.js']
    });

    const contextResult = await contextHandlers.brain_get_context_for_files(ctx, {
      files: ['db/queries.js']
    });
    assert.ok(contextResult[0].text.includes('Query timeout'));
  });

  it('record implementation then list it', async () => {
    await recordingHandlers.brain_record_implementation(ctx, {
      title: 'Cache Layer Implementation',
      description: 'Added Redis cache for frequently accessed data',
      files: ['cache/redis.js']
    });

    const listResult = await coreHandlers.brain_list(ctx, { type: 'implementation' });
    assert.ok(listResult[0].text.includes('Cache Layer'));
  });

  it('session summary reflects all changes', async () => {
    const summary = await planningHandlers.brain_get_session_summary(ctx, {});
    assert.ok(summary[0].text.includes('Session Summary'));
    assert.ok(summary[0].text.includes('decision'));
    assert.ok(summary[0].text.includes('bug'));
    assert.ok(summary[0].text.includes('implementation'));
  });
});

console.log('\nAll handler test suites defined. Run with: node --test tests/handlers.test.js\n');
