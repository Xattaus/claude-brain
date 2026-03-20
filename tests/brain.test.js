#!/usr/bin/env node

/**
 * Brain MCP Server — Test Suite
 * 
 * Uses Node.js built-in test runner (node:test). No dependencies needed.
 * Run: node --test test-brain.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainManager } from '../lib/brain-manager.js';
import { BrainSearch } from '../lib/search.js';
import { ConflictChecker } from '../lib/conflict-checker.js';

// ── Test helpers ──

async function createTestBrain() {
    const tempDir = await mkdtemp(join(tmpdir(), 'brain-test-'));
    const manager = new BrainManager(tempDir);
    await manager.initBrain({
        projectName: 'test-project',
        overview: '# Test Project\n\nThis is a test project.',
        paths: [{ path: tempDir, label: 'root' }]
    });
    return { tempDir, manager };
}

// ── Path Matching Tests ──

describe('getEntriesByFiles — path matching', () => {
    let manager, tempDir;

    before(async () => {
        const ctx = await createTestBrain();
        manager = ctx.manager;
        tempDir = ctx.tempDir;

        // Create entries with specific file paths
        await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Use React', frontmatter: { status: 'active', tags: [], files: ['src/utils.js'], related: [] },
            body: '## Decision\nUse React.'
        });
        await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Use Vue', frontmatter: { status: 'active', tags: [], files: ['src/test-utils.js'], related: [] },
            body: '## Decision\nUse Vue.'
        });
        await manager.createEntry({
            type: 'bug', prefix: 'BUG', dirName: 'bugs',
            title: 'Login bug', frontmatter: { status: 'open', severity: 'high', tags: [], files: ['auth/login.js'], related: [] },
            body: '## Bug\nLogin broken.'
        });
    });

    after(async () => { await rm(tempDir, { recursive: true, force: true }); });

    it('exact match: utils.js should NOT match test-utils.js', async () => {
        const results = await manager.getEntriesByFiles(['utils.js']);
        const ids = results.map(e => e.id);
        assert.ok(ids.includes('DEC-001'), 'Should match DEC-001 (src/utils.js)');
        assert.ok(!ids.includes('DEC-002'), 'Should NOT match DEC-002 (src/test-utils.js)');
    });

    it('suffix match with path separator: src/utils.js matches utils.js', async () => {
        const results = await manager.getEntriesByFiles(['utils.js']);
        assert.ok(results.some(e => e.id === 'DEC-001'));
    });

    it('exact path match works', async () => {
        const results = await manager.getEntriesByFiles(['src/utils.js']);
        assert.ok(results.some(e => e.id === 'DEC-001'));
    });

    it('no match returns empty', async () => {
        const results = await manager.getEntriesByFiles(['nonexistent.js']);
        assert.equal(results.length, 0);
    });

    it('backslash normalization works', async () => {
        const results = await manager.getEntriesByFiles(['auth\\login.js']);
        assert.ok(results.some(e => e.id === 'BUG-001'));
    });

    it('case-insensitive matching', async () => {
        const results = await manager.getEntriesByFiles(['SRC/Utils.js']);
        assert.ok(results.some(e => e.id === 'DEC-001'));
    });
});

// ── Path Normalization Tests ──

describe('normalizePath', () => {
    let manager;
    before(async () => { manager = new BrainManager('/tmp/test'); });

    it('converts backslashes to forward slashes', () => {
        assert.equal(manager.normalizePath('src\\lib\\utils.js'), 'src/lib/utils.js');
    });

    it('strips leading ./', () => {
        assert.equal(manager.normalizePath('./src/utils.js'), 'src/utils.js');
    });

    it('lowercases the path', () => {
        assert.equal(manager.normalizePath('SRC/Utils.JS'), 'src/utils.js');
    });

    it('handles mixed separators', () => {
        assert.equal(manager.normalizePath('.\\SRC/Utils.JS'), 'src/utils.js');
    });
});

// ── YAML Tests ──

describe('YAML helpers', () => {
    let manager;
    before(async () => { manager = new BrainManager('/tmp/test'); });

    it('escapeYaml escapes quotes', () => {
        assert.equal(manager.escapeYaml('say "hello"'), 'say \\"hello\\"');
    });

    it('escapeYaml escapes newlines', () => {
        assert.equal(manager.escapeYaml('line1\nline2'), 'line1\\nline2');
    });

    it('formatYamlValue handles arrays of strings', () => {
        const result = manager.formatYamlValue(['a', 'b']);
        assert.equal(result, '["a", "b"]');
    });

    it('formatYamlValue handles null', () => {
        assert.equal(manager.formatYamlValue(null), 'null');
    });

    it('formatYamlValue handles relation objects', () => {
        const result = manager.formatYamlValue([{ id: 'DEC-001', rel: 'implements' }]);
        assert.equal(result, '["DEC-001:implements"]');
    });
});

// ── CRUD Tests ──

describe('Entry CRUD', () => {
    let manager, tempDir;

    before(async () => {
        const ctx = await createTestBrain();
        manager = ctx.manager;
        tempDir = ctx.tempDir;
    });

    after(async () => { await rm(tempDir, { recursive: true, force: true }); });

    it('createEntry → getEntry round-trip', async () => {
        const result = await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Test Decision',
            frontmatter: { status: 'active', tags: ['test'], files: ['app.js'], related: [] },
            body: '## Context\nTest context.\n\n## Decision\nTest decision.'
        });

        assert.ok(result.id.startsWith('DEC-'));

        const entry = await manager.getEntry(result.id);
        assert.ok(entry);
        assert.equal(entry.title, 'Test Decision');
        assert.ok(entry.content.includes('Test context'));
    });

    it('updateEntry changes status', async () => {
        // Create then update
        const result = await manager.createEntry({
            type: 'bug', prefix: 'BUG', dirName: 'bugs',
            title: 'Test Bug',
            frontmatter: { status: 'open', severity: 'medium', tags: [], files: [], related: [] },
            body: '## Symptoms\nBroken.\n\n## Root Cause\nBad code.\n\n## Fix\nGood code.'
        });

        const updated = await manager.updateEntry(result.id, { status: 'fixed' });
        assert.ok(updated);
        assert.equal(updated.status, 'fixed');
    });

    it('listEntries filters by type', async () => {
        const decisions = await manager.listEntries({ type: 'decision' });
        assert.ok(decisions.length > 0);
        assert.ok(decisions.every(e => e.type === 'decision'));
    });
});

// ── Search Tests ──

describe('BrainSearch', () => {
    let manager, search, tempDir;

    before(async () => {
        const ctx = await createTestBrain();
        manager = ctx.manager;
        tempDir = ctx.tempDir;
        search = new BrainSearch(manager);

        await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Authentication Strategy',
            frontmatter: { status: 'active', tags: ['auth', 'security'], files: ['auth.js'], related: [] },
            body: '## Context\nNeed authentication.\n\n## Decision\nUse JWT tokens.'
        });
        await manager.createEntry({
            type: 'implementation', prefix: 'IMPL', dirName: 'implementations',
            title: 'Database Connection Pool',
            frontmatter: { status: 'current', tags: ['database', 'performance'], files: ['db.js'], related: [] },
            body: '## Description\nConnection pooling implemented.'
        });
    });

    after(async () => { await rm(tempDir, { recursive: true, force: true }); });

    it('basic search finds matching entries', async () => {
        const results = await search.search('authentication');
        assert.ok(results.length > 0);
        assert.ok(results.some(r => r.title.includes('Authentication')));
    });

    it('search with type filter', async () => {
        const results = await search.search('authentication', { type: 'decision' });
        assert.ok(results.every(r => r.type === 'decision'));
    });

    it('empty query returns all entries', async () => {
        const results = await search.search('');
        assert.ok(results.length > 0);
    });

    it('no match returns empty', async () => {
        const results = await search.search('xyznonexistent123');
        assert.equal(results.length, 0);
    });
});

// ── Conflict Checker Tests ──

describe('ConflictChecker', () => {
    let manager, checker, tempDir;

    before(async () => {
        const ctx = await createTestBrain();
        manager = ctx.manager;
        tempDir = ctx.tempDir;
        checker = new ConflictChecker(manager);

        await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'API Rate Limiting',
            frontmatter: { status: 'active', tags: ['api', 'rate-limiting'], files: ['middleware/rate-limit.js'], related: [] },
            body: '## Context\nNeed rate limiting.\n\n## Decision\nUse token bucket.'
        });
        await manager.createEntry({
            type: 'bug', prefix: 'BUG', dirName: 'bugs',
            title: 'Critical Auth Bypass',
            frontmatter: { status: 'open', severity: 'critical', tags: ['auth', 'security'], files: ['auth/handler.js'], related: [] },
            body: '## Symptoms\nBypass possible.\n\n## Root Cause\nMissing check.\n\n## Fix\nAdd check.'
        });
    });

    after(async () => { await rm(tempDir, { recursive: true, force: true }); });

    it('detects file-based conflicts with active decisions', async () => {
        const { conflicts } = await checker.check('Change rate limiting', ['middleware/rate-limit.js']);
        assert.ok(conflicts.length > 0);
        assert.ok(conflicts.some(c => c.entry_id === 'DEC-001'));
    });

    it('critical bug triggers CONFLICT not WARNING', async () => {
        const { conflicts } = await checker.check('Modify auth', ['auth/handler.js']);
        assert.ok(conflicts.some(c => c.type === 'bug'));
    });

    it('no conflict for unrelated files', async () => {
        const { conflicts, warnings } = await checker.check('Change UI', ['components/button.js']);
        assert.equal(conflicts.length, 0);
        // Keyword matches might still produce warnings, but no direct conflicts
    });

    it('keyword-based matching works', async () => {
        const { conflicts, warnings } = await checker.check('Change the API rate limiting logic', []);
        const allResults = [...conflicts, ...warnings];
        assert.ok(allResults.some(r => r.entry_id === 'DEC-001'));
    });
});

// ── Rebuild Index Tests ──

describe('rebuildIndex', () => {
    let manager, tempDir;

    before(async () => {
        const ctx = await createTestBrain();
        manager = ctx.manager;
        tempDir = ctx.tempDir;

        // Create some entries
        await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Rebuild Test Decision',
            frontmatter: { status: 'active', tags: ['test'], files: ['app.js'], related: [] },
            body: '## Context\nTest.\n\n## Decision\nTest.'
        });
        await manager.createEntry({
            type: 'bug', prefix: 'BUG', dirName: 'bugs',
            title: 'Rebuild Test Bug',
            frontmatter: { status: 'fixed', severity: 'low', tags: ['test'], files: [], related: [] },
            body: '## Symptoms\nN/A.\n\n## Root Cause\nN/A.\n\n## Fix\nN/A.'
        });
    });

    after(async () => { await rm(tempDir, { recursive: true, force: true }); });

    it('recovers entries from corrupted index', async () => {
        // Corrupt the index
        await writeFile(join(tempDir, '.brain', 'index.json'), 'CORRUPTED', 'utf-8');

        // Rebuild
        const result = await manager.rebuildIndex();
        assert.ok(result.entriesFound >= 2, `Expected at least 2 entries, got ${result.entriesFound}`);
        assert.ok(result.counters.DEC >= 1);
        assert.ok(result.counters.BUG >= 1);

        // Verify recovered entries are accessible
        const index = await manager.loadIndex();
        assert.ok(index.entries.length >= 2);
    });

    it('preserves entry details after rebuild', async () => {
        const entry = await manager.getEntry('DEC-001');
        assert.ok(entry, 'DEC-001 should be accessible after rebuild');
        assert.equal(entry.title, 'Rebuild Test Decision');
    });
});

// ── Edge Case Tests ──

describe('Entry CRUD — edge cases', () => {
    let manager, tempDir;

    before(async () => {
        const ctx = await createTestBrain();
        manager = ctx.manager;
        tempDir = ctx.tempDir;
    });

    after(async () => { await rm(tempDir, { recursive: true, force: true }); });

    it('create → update → verify round-trip preserves data', async () => {
        const result = await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Snapshot Round-Trip Test',
            frontmatter: { status: 'active', tags: ['test', 'roundtrip'], files: ['app.js'], related: [] },
            body: '## Context\nOriginal context.\n\n## Decision\nOriginal decision.'
        });

        // Update content
        await manager.updateEntry(result.id, {
            status: 'superseded',
            content: '## Context\nUpdated context.\n\n## Decision\nUpdated decision.'
        });

        // Verify
        const entry = await manager.getEntry(result.id);
        assert.equal(entry.status, 'superseded');
        assert.ok(entry.content.includes('Updated context'));
        assert.ok(!entry.content.includes('Original context'));
    });

    it('handles YAML special characters in title', async () => {
        const result = await manager.createEntry({
            type: 'bug', prefix: 'BUG', dirName: 'bugs',
            title: 'Bug with "quotes" and colons: here',
            frontmatter: { status: 'open', severity: 'low', tags: [], files: [], related: [] },
            body: '## Symptoms\nSpecial chars.\n\n## Root Cause\nN/A.\n\n## Fix\nN/A.'
        });

        const entry = await manager.getEntry(result.id);
        assert.ok(entry, 'Should retrieve entry with special chars');
        assert.ok(entry.content.includes('Bug with'));
    });

    it('getEntry returns null for nonexistent ID', async () => {
        const entry = await manager.getEntry('DEC-999');
        assert.equal(entry, null);
    });

    it('updateEntry returns null for nonexistent ID', async () => {
        const result = await manager.updateEntry('DEC-999', { status: 'fixed' });
        assert.equal(result, null);
    });

    it('linkEntries throws for nonexistent entry', async () => {
        await assert.rejects(
            () => manager.linkEntries('DEC-999', 'DEC-998', 'relates_to'),
            /Entry not found/
        );
    });

    it('linkEntries throws for invalid relation type', async () => {
        const r1 = await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Link Test A',
            frontmatter: { status: 'active', tags: [], files: [], related: [] },
            body: '## Decision\nA.'
        });
        const r2 = await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Link Test B',
            frontmatter: { status: 'active', tags: [], files: [], related: [] },
            body: '## Decision\nB.'
        });

        await assert.rejects(
            () => manager.linkEntries(r1.id, r2.id, 'invalid_type'),
            /Unknown relation type/
        );
    });
});

// ── Search Edge Cases ──

describe('BrainSearch — edge cases', () => {
    let manager, search, tempDir;

    before(async () => {
        const ctx = await createTestBrain();
        manager = ctx.manager;
        tempDir = ctx.tempDir;
        search = new BrainSearch(manager);

        await manager.createEntry({
            type: 'decision', prefix: 'DEC', dirName: 'decisions',
            title: 'Unicode Test: Ääkköset ja Öljy',
            frontmatter: { status: 'active', tags: ['suomi', 'testi'], files: [], related: [] },
            body: '## Konteksti\nTämä on testi.\n\n## Päätös\nÄäkköset toimivat.'
        });
    });

    after(async () => { await rm(tempDir, { recursive: true, force: true }); });

    it('search handles single character query gracefully', async () => {
        const results = await search.search('a');
        // Single char queries are filtered out (length > 1), so this tests empty results path
    });

    it('search handles special regex characters', async () => {
        // Should not throw even with regex-special chars
        const results = await search.search('test (with) [brackets]');
        // No assertion on results, just shouldn't throw
    });

    it('extractKeywords handles empty string', () => {
        const keywords = search.extractKeywords('');
        assert.deepEqual(keywords, []);
    });

    it('extractKeywords filters stop words', () => {
        const keywords = search.extractKeywords('the authentication is being tested');
        assert.ok(!keywords.includes('the'));
        assert.ok(!keywords.includes('is'));
        assert.ok(!keywords.includes('being'));
        // After word processing: 'authentication' → 'auth' (synonym), 'tested' → 'test' (synonym)
        assert.ok(keywords.includes('auth'));
        assert.ok(keywords.includes('test'));
    });
});

console.log('\\n✅ All test suites defined. Run with: node --test test-brain.js\\n');
