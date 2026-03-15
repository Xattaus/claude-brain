#!/usr/bin/env node

/**
 * Validation Tests — Zod schemas, YAML escaping, duplicate detection
 * Run: node --test test-validation.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateToolArgs } from '../lib/schemas.js';
import { BrainManager } from '../lib/brain-manager.js';

// ── Zod Schema Tests ──

describe('Zod validation — entry IDs', () => {
  it('valid IDs pass', () => {
    for (const id of ['DEC-001', 'BUG-123', 'IMPL-999', 'PAT-042', 'LES-010', 'PLAN-001']) {
      const r = validateToolArgs('brain_get_entry', { id });
      assert.ok(r.success, `${id} should be valid`);
    }
  });

  it('invalid IDs fail', () => {
    for (const id of ['DEC-1', 'dec-001', 'DEC001', 'FOO-001', '', 'DEC-', '001-DEC']) {
      const r = validateToolArgs('brain_get_entry', { id });
      assert.ok(!r.success, `${id} should be invalid`);
    }
  });
});

describe('Zod validation — titles', () => {
  it('valid titles pass', () => {
    const r = validateToolArgs('brain_record_decision', {
      title: 'Use React for frontend',
      context: 'Need a framework',
      decision: 'Use React'
    });
    assert.ok(r.success);
  });

  it('too short title fails', () => {
    const r = validateToolArgs('brain_record_decision', {
      title: 'ab',
      context: 'Need a framework',
      decision: 'Use React'
    });
    assert.ok(!r.success);
    assert.ok(r.error.includes('3 characters'));
  });

  it('too long title fails', () => {
    const r = validateToolArgs('brain_record_decision', {
      title: 'x'.repeat(201),
      context: 'Need a framework',
      decision: 'Use React'
    });
    assert.ok(!r.success);
    assert.ok(r.error.includes('200 characters'));
  });
});

describe('Zod validation — relation types', () => {
  it('valid relation types pass', () => {
    const r = validateToolArgs('brain_link_entries', {
      from: 'IMPL-001',
      to: 'DEC-001',
      rel: 'implements'
    });
    assert.ok(r.success);
  });

  it('invalid relation type fails', () => {
    const r = validateToolArgs('brain_link_entries', {
      from: 'IMPL-001',
      to: 'DEC-001',
      rel: 'depends_on'
    });
    assert.ok(!r.success);
  });
});

describe('Zod validation — required fields', () => {
  it('missing context fails for decision', () => {
    const r = validateToolArgs('brain_record_decision', {
      title: 'Test Decision',
      decision: 'Decide something'
    });
    assert.ok(!r.success);
    assert.ok(r.error.includes('context'));
  });

  it('missing symptoms fails for bug', () => {
    const r = validateToolArgs('brain_record_bug', {
      title: 'Test Bug',
      root_cause: 'Bad code',
      fix: 'Good code'
    });
    assert.ok(!r.success);
  });

  it('missing rule fails for lesson', () => {
    const r = validateToolArgs('brain_record_lesson', {
      title: 'Test Lesson',
      what_happened: 'Something went wrong',
      lesson: 'Do better'
    });
    assert.ok(!r.success);
    assert.ok(r.error.includes('rule'));
  });
});

describe('Zod validation — defaults', () => {
  it('bug severity defaults to medium', () => {
    const r = validateToolArgs('brain_record_bug', {
      title: 'Test Bug',
      symptoms: 'Broken',
      root_cause: 'Bad code',
      fix: 'Good code'
    });
    assert.ok(r.success);
    assert.equal(r.data.severity, 'medium');
  });

  it('lesson trigger defaults to discovery', () => {
    const r = validateToolArgs('brain_record_lesson', {
      title: 'Test Lesson',
      what_happened: 'Something happened',
      lesson: 'Do better',
      rule: 'Always test'
    });
    assert.ok(r.success);
    assert.equal(r.data.trigger, 'discovery');
  });

  it('tags default to empty array', () => {
    const r = validateToolArgs('brain_record_decision', {
      title: 'Test Decision',
      context: 'Need a framework',
      decision: 'Use React'
    });
    assert.ok(r.success);
    assert.deepEqual(r.data.tags, []);
  });
});

describe('Zod validation — tools without schemas pass through', () => {
  it('brain_get_overview passes without schema', () => {
    const r = validateToolArgs('brain_get_overview', { compact: true });
    assert.ok(r.success);
  });

  it('unknown tool passes without schema', () => {
    const r = validateToolArgs('brain_nonexistent', { foo: 'bar' });
    assert.ok(r.success);
  });
});

// ── YAML Escaping Tests ──

describe('escapeYaml — special characters', () => {
  let manager;
  before(() => { manager = new BrainManager('/tmp/test'); });

  it('escapes double quotes', () => {
    assert.equal(manager.escapeYaml('say "hello"'), 'say \\"hello\\"');
  });

  it('escapes newlines', () => {
    assert.equal(manager.escapeYaml('line1\nline2'), 'line1\\nline2');
  });

  it('escapes carriage returns', () => {
    assert.equal(manager.escapeYaml('line1\rline2'), 'line1\\rline2');
  });

  it('escapes tabs', () => {
    assert.equal(manager.escapeYaml('col1\tcol2'), 'col1\\tcol2');
  });

  it('escapes backslashes', () => {
    assert.equal(manager.escapeYaml('path\\to\\file'), 'path\\\\to\\\\file');
  });

  it('handles combined special chars', () => {
    const input = 'He said "hi"\nThen\ttabbed\\away';
    const escaped = manager.escapeYaml(input);
    assert.ok(!escaped.includes('\n'));
    assert.ok(!escaped.includes('\t'));
    assert.ok(escaped.includes('\\n'));
    assert.ok(escaped.includes('\\t'));
  });

  it('handles empty string', () => {
    assert.equal(manager.escapeYaml(''), '');
  });

  it('handles string without special chars', () => {
    assert.equal(manager.escapeYaml('simple text'), 'simple text');
  });
});

// ── Duplicate Detection Tests ──

describe('checkDuplicate — Jaccard similarity', () => {
  let manager, tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'brain-dup-test-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'test-project',
      overview: '# Test',
      paths: [{ path: tempDir, label: 'root' }]
    });

    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Use React for Frontend Development',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Decision\nUse React.'
    });
    await manager.createEntry({
      type: 'decision', prefix: 'DEC', dirName: 'decisions',
      title: 'Database Connection Pooling Strategy',
      frontmatter: { status: 'active', tags: [], files: [], related: [] },
      body: '## Decision\nUse connection pooling.'
    });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('detects similar titles', async () => {
    const dupes = await manager.checkDuplicate('Use React for UI Development', 'decision');
    assert.ok(dupes.length > 0);
    assert.equal(dupes[0].id, 'DEC-001');
    assert.ok(dupes[0].similarity >= 0.5);
  });

  it('does not match unrelated titles', async () => {
    const dupes = await manager.checkDuplicate('API Rate Limiting Strategy', 'decision');
    assert.equal(dupes.length, 0);
  });

  it('respects type filter', async () => {
    const dupes = await manager.checkDuplicate('Use React for Frontend Development', 'bug');
    assert.equal(dupes.length, 0);
  });

  it('skips superseded entries', async () => {
    await manager.updateEntry('DEC-001', { status: 'superseded' });
    const dupes = await manager.checkDuplicate('Use React for Frontend Development', 'decision');
    assert.equal(dupes.length, 0);
    // Restore
    await manager.updateEntry('DEC-001', { status: 'active' });
  });

  it('handles exact match', async () => {
    const dupes = await manager.checkDuplicate('Use React for Frontend Development', 'decision');
    assert.ok(dupes.length > 0);
    assert.equal(dupes[0].similarity, 1);
  });
});

console.log('\n✅ Validation test suites defined. Run with: node --test test-validation.js\n');
