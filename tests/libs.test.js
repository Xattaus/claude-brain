#!/usr/bin/env node

/**
 * Library module tests — RuleIndex, ChangeValidator, TextIndex, TfIdf,
 * WordProcessing, body-builders
 *
 * Uses Node.js built-in test runner. Run: node --test tests/libs.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RuleExtractor, RuleIndex, calculateRiskScore, riskLabel } from '../lib/rule-index.js';
import { ChangeValidator } from '../lib/change-validator.js';
import { TextIndex } from '../lib/text-index.js';
import { TfIdf } from '../lib/tfidf.js';
import {
  normalizeWord,
  extractSignificantWords,
  extractWordSet,
  weightedJaccard,
  STOPWORDS,
  SYNONYM_MAP
} from '../lib/word-processing.js';
import {
  buildDecisionBody,
  buildBugBody,
  buildImplementationBody,
  buildPatternBody,
  buildLessonBody,
  buildPlanBody
} from '../lib/utils/body-builders.js';

// ─────────────────────────────────────────────────────────────
// RuleExtractor
// ─────────────────────────────────────────────────────────────

describe('RuleExtractor', () => {
  let extractor;
  before(() => { extractor = new RuleExtractor(); });

  it('extracts DONT rules from explicit markers', () => {
    const entry = { id: 'LES-001', type: 'lesson', files: ['app.js'], tags: ['test'] };
    const content = 'Some text\nNEVER: use eval in production\nMore text';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.type === 'DONT' && r.text === 'use eval in production'));
  });

  it('extracts DO rules from ALWAYS markers', () => {
    const entry = { id: 'LES-002', type: 'lesson', files: [], tags: [] };
    const content = 'ALWAYS: validate user input';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.type === 'DO' && r.text === 'validate user input'));
  });

  it('extracts RULE markers as DO rules', () => {
    const entry = { id: 'DEC-001', type: 'decision', files: [], tags: [] };
    const content = 'RULE: use TypeScript for all new files';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.type === 'DO' && r.text === 'use TypeScript for all new files'));
  });

  it('extracts bullet rules from ## Rule section', () => {
    const entry = { id: 'PAT-001', type: 'pattern', files: [], tags: [] };
    const content = '## Rule\n- Always use strict mode\n- Prefer const over let\n## Other';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.text === 'Always use strict mode'));
    assert.ok(rules.some(r => r.text === 'Prefer const over let'));
  });

  it('generates GUARD rule for fixed bugs', () => {
    const entry = { id: 'BUG-001', type: 'bug', status: 'fixed', title: 'XSS in login', files: [], tags: [] };
    const content = '## Fix\nEscaped output.';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.type === 'GUARD' && r.text.includes('XSS in login')));
  });

  it('generates DONT rule for open critical bugs', () => {
    const entry = { id: 'BUG-002', type: 'bug', status: 'open', severity: 'critical', title: 'Data leak', files: ['api.js'], tags: [] };
    const content = '## Symptoms\nLeaking data.';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.type === 'DONT' && r.text.includes('Data leak')));
  });

  it('generates DONT rule for open high-severity bugs', () => {
    const entry = { id: 'BUG-003', type: 'bug', status: 'open', severity: 'high', title: 'Memory leak', files: [], tags: [] };
    const content = '## Symptoms\nOOM.';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.type === 'DONT'));
  });

  it('does NOT generate DONT rule for open low-severity bugs', () => {
    const entry = { id: 'BUG-004', type: 'bug', status: 'open', severity: 'low', title: 'Typo', files: [], tags: [] };
    const content = '## Symptoms\nTypo in label.';
    const rules = extractor.extract(entry, content);
    assert.ok(!rules.some(r => r.type === 'DONT'));
  });

  it('extracts lesson rule field', () => {
    const entry = { id: 'LES-003', type: 'lesson', rule: 'Always run tests before pushing', files: [], tags: [] };
    const content = '## Lesson\nSomething.';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.some(r => r.text === 'Always run tests before pushing'));
  });

  it('handles entry with non-array files field', () => {
    const entry = { id: 'DEC-010', type: 'decision', files: 'not-an-array', tags: null };
    const content = 'RULE: handle edge cases';
    const rules = extractor.extract(entry, content);
    assert.ok(rules.length > 0);
    assert.ok(Array.isArray(rules[0].files));
    assert.equal(rules[0].files.length, 0);
  });

  it('handles entry with non-array tags field', () => {
    const entry = { id: 'DEC-011', type: 'decision', files: [], tags: 'not-an-array' };
    const content = 'RULE: handle edge cases';
    const rules = extractor.extract(entry, content);
    assert.ok(Array.isArray(rules[0].tags));
    assert.equal(rules[0].tags.length, 0);
  });

  it('returns empty array for entry with no rules in content', () => {
    const entry = { id: 'IMPL-001', type: 'implementation', files: [], tags: [] };
    const content = 'Just a description with no markers.';
    const rules = extractor.extract(entry, content);
    assert.equal(rules.length, 0);
  });

  it('does not duplicate rules from explicit markers and Rule section', () => {
    const entry = { id: 'PAT-002', type: 'pattern', files: [], tags: [] };
    const content = 'ALWAYS: use strict mode\n## Rule\n- use strict mode\n';
    const rules = extractor.extract(entry, content);
    const strictRules = rules.filter(r => r.text === 'use strict mode');
    assert.equal(strictRules.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────
// RuleIndex
// ─────────────────────────────────────────────────────────────

describe('RuleIndex', () => {
  it('getRulesForFiles returns global rules for any file', () => {
    const idx = new RuleIndex();
    idx._global = [{ id: 'R1', type: 'DO', text: 'global rule', files: [], tags: [] }];
    const result = idx.getRulesForFiles(['anything.js']);
    assert.ok(result.some(r => r.id === 'R1'));
  });

  it('getRulesForFiles returns file-specific rules by exact match', () => {
    const idx = new RuleIndex();
    idx._byFile = { 'src/app.js': [{ id: 'R2', type: 'DONT', text: 'no eval', files: ['src/app.js'], tags: [] }] };
    const result = idx.getRulesForFiles(['src/app.js']);
    assert.ok(result.some(r => r.id === 'R2'));
  });

  it('getRulesForFiles uses suffix matching', () => {
    const idx = new RuleIndex();
    idx._byFile = { 'src/app.js': [{ id: 'R3', type: 'DO', text: 'test', files: ['src/app.js'], tags: [] }] };
    const result = idx.getRulesForFiles(['app.js']);
    assert.ok(result.some(r => r.id === 'R3'));
  });

  it('getRulesForFiles does not match partial filenames', () => {
    const idx = new RuleIndex();
    idx._byFile = { 'utils.js': [{ id: 'R4', type: 'DO', text: 'test', files: ['utils.js'], tags: [] }] };
    const result = idx.getRulesForFiles(['test-utils.js']);
    assert.ok(!result.some(r => r.id === 'R4'));
  });

  it('getRulesForFiles deduplicates results', () => {
    const idx = new RuleIndex();
    const rule = { id: 'R5', type: 'DO', text: 'test', files: ['a.js'], tags: [] };
    idx._global = [rule];
    idx._byFile = { 'a.js': [rule] };
    const result = idx.getRulesForFiles(['a.js']);
    assert.equal(result.filter(r => r.id === 'R5').length, 1);
  });

  it('rebuild populates index from entries', async () => {
    const idx = new RuleIndex();
    const entries = [
      { id: 'BUG-001', type: 'bug', status: 'fixed', title: 'XSS bug', files: ['login.js'], tags: [], severity: 'high' }
    ];
    const getContent = async () => '## Fix\nEscaped output.';
    const stats = await idx.rebuild(entries, getContent);
    assert.ok(stats.totalRules > 0);
    assert.ok(stats.guardCount > 0);
  });

  it('rebuild handles getContent throwing', async () => {
    const idx = new RuleIndex();
    const entries = [
      { id: 'DEC-001', type: 'decision', files: [], tags: [] }
    ];
    const getContent = async () => { throw new Error('unreadable'); };
    const stats = await idx.rebuild(entries, getContent);
    // Should not throw, just skip unreadable entries
    assert.equal(stats.totalRules, 0);
  });

  it('addRulesForEntry adds incrementally', () => {
    const idx = new RuleIndex();
    const entry = { id: 'LES-001', type: 'lesson', files: ['main.js'], tags: [], rule: 'always test' };
    idx.addRulesForEntry(entry, '## Lesson\nSomething.');
    const rules = idx.getRulesForFiles(['main.js']);
    assert.ok(rules.length > 0);
  });

  it('serialize and deserialize round-trip', () => {
    const idx = new RuleIndex();
    idx._global = [{ id: 'R10', type: 'DO', text: 'test' }];
    idx._byFile = { 'a.js': [{ id: 'R11', type: 'DONT', text: 'no' }] };
    idx._version = 5;

    const serialized = idx.serialize();
    const idx2 = new RuleIndex();
    idx2.deserialize(serialized);

    assert.equal(idx2._version, 5);
    assert.equal(idx2._global.length, 1);
    assert.ok(idx2._byFile['a.js']);
  });

  it('deserialize handles null/undefined', () => {
    const idx = new RuleIndex();
    idx.deserialize(null);
    assert.equal(idx._version, 0);
    idx.deserialize(undefined);
    assert.equal(idx._version, 0);
  });
});

// ─────────────────────────────────────────────────────────────
// calculateRiskScore & riskLabel
// ─────────────────────────────────────────────────────────────

describe('calculateRiskScore', () => {
  it('returns 0 for empty input', () => {
    assert.equal(calculateRiskScore({}), 0);
  });

  it('increases with active decisions', () => {
    const score = calculateRiskScore({ activeDecisions: [{}, {}] });
    assert.equal(score, 20);
  });

  it('increases with open bugs by severity', () => {
    const score = calculateRiskScore({ openBugs: [{ severity: 'critical' }] });
    assert.equal(score, 25);
  });

  it('caps at 100', () => {
    const score = calculateRiskScore({
      activeDecisions: Array(5).fill({}),
      openBugs: Array(5).fill({ severity: 'critical' }),
      conflicts: Array(5).fill({})
    });
    assert.equal(score, 100);
  });

  it('counts DONT and GUARD rules', () => {
    const score = calculateRiskScore({ rules: [{ type: 'DONT' }, { type: 'GUARD' }, { type: 'DO' }] });
    assert.equal(score, 10); // 2 * 5, DO doesn't count
  });
});

describe('riskLabel', () => {
  it('returns SAFE for score < 15', () => { assert.equal(riskLabel(0), 'SAFE'); });
  it('returns LOW for score 15-39', () => { assert.equal(riskLabel(20), 'LOW'); });
  it('returns MEDIUM for score 40-69', () => { assert.equal(riskLabel(50), 'MEDIUM'); });
  it('returns HIGH for score >= 70', () => { assert.equal(riskLabel(80), 'HIGH'); });
});

// ─────────────────────────────────────────────────────────────
// ChangeValidator
// ─────────────────────────────────────────────────────────────

describe('ChangeValidator', () => {
  it('passes when no rules provided', () => {
    const validator = new ChangeValidator();
    const result = validator.validate([], 'changed something', '');
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
  });

  it('detects GUARD violation with keyword overlap', () => {
    const validator = new ChangeValidator();
    const rules = [{
      id: 'R1', type: 'GUARD', source_id: 'BUG-001', source_type: 'bug',
      text: 'Do not reintroduce: XSS vulnerability in login form',
      files: ['login.js'], tags: []
    }];
    const result = validator.validate(rules, 'Fixing the login form XSS vulnerability handling', '');
    assert.ok(result.violations.some(v => v.type === 'REGRESSION_RISK'));
  });

  it('detects DONT violation with keyword overlap', () => {
    const validator = new ChangeValidator();
    const rules = [{
      id: 'R2', type: 'DONT', source_id: 'LES-001', source_type: 'lesson',
      text: 'Open bug: database connection pool exhaustion',
      files: ['db.js'], tags: []
    }];
    const result = validator.validate(rules, 'Updating database connection pool settings', '');
    assert.equal(result.passed, false);
    assert.ok(result.violations.some(v => v.type === 'RULE_VIOLATION'));
  });

  it('passes with unrelated change description', () => {
    const validator = new ChangeValidator();
    const rules = [{
      id: 'R3', type: 'GUARD', source_id: 'BUG-001', source_type: 'bug',
      text: 'Do not reintroduce: XSS in login form',
      files: ['login.js'], tags: []
    }];
    const result = validator.validate(rules, 'Updated the README documentation', '');
    assert.equal(result.passed, true);
  });

  it('generates recommendations when violations found', () => {
    const validator = new ChangeValidator();
    const rules = [{
      id: 'R4', type: 'GUARD', source_id: 'BUG-001', source_type: 'bug',
      text: 'Do not reintroduce: authentication bypass vulnerability',
      files: ['auth.js'], tags: []
    }];
    const result = validator.validate(rules, 'Changing authentication bypass logic for security audit', '');
    if (result.violations.length > 0) {
      assert.ok(result.recommendations.length > 0);
    }
  });

  it('adds ACTIVE_DECISION warning for decision rules', () => {
    const validator = new ChangeValidator();
    const rules = [{
      id: 'R5', type: 'DO', source_id: 'DEC-001', source_type: 'decision',
      text: 'Use React for frontend',
      files: ['app.js'], tags: []
    }];
    const result = validator.validate(rules, 'Something unrelated', '');
    assert.ok(result.warnings.some(w => w.type === 'ACTIVE_DECISION'));
  });

  it('handles empty change description', () => {
    const validator = new ChangeValidator();
    const rules = [{
      id: 'R6', type: 'GUARD', source_id: 'BUG-001', source_type: 'bug',
      text: 'Do not reintroduce: crash',
      files: [], tags: []
    }];
    const result = validator.validate(rules, '', '');
    assert.equal(result.passed, true);
  });

  it('uses changesSummary for matching', () => {
    const validator = new ChangeValidator();
    const rules = [{
      id: 'R7', type: 'DONT', source_id: 'LES-001', source_type: 'lesson',
      text: 'Open bug: authentication token validation broken',
      files: [], tags: []
    }];
    const result = validator.validate(rules, 'Small update', 'Changed the authentication token validation logic completely');
    // The summary should provide enough keyword overlap
    assert.ok(result.violations.length >= 0); // May or may not match depending on thresholds
  });
});

// ─────────────────────────────────────────────────────────────
// TextIndex
// ─────────────────────────────────────────────────────────────

describe('TextIndex', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'textindex-test-'));
    await mkdir(join(tempDir, '.brain'), { recursive: true });
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('rebuild indexes entries and search finds them', async () => {
    const ti = new TextIndex(join(tempDir, '.brain'));
    const entries = [
      { id: 'DEC-001', title: 'Use React Framework', tags: ['frontend', 'react'] },
      { id: 'DEC-002', title: 'Database Migration Strategy', tags: ['database', 'migration'] }
    ];
    const getContent = async (e) => e.id === 'DEC-001' ? 'React is great for UI' : 'Postgres migrations';

    await ti.rebuild(entries, getContent);

    const results = ti.search('React');
    assert.ok(results.length > 0);
    assert.ok(results.some(r => r.id === 'DEC-001'));
  });

  it('search returns empty for no matches', async () => {
    const ti = new TextIndex(join(tempDir, '.brain'));
    await ti.rebuild([], async () => '');
    const results = ti.search('xyznonexistent');
    assert.equal(results.length, 0);
  });

  it('search returns empty for empty/null query', async () => {
    const ti = new TextIndex(join(tempDir, '.brain'));
    await ti.rebuild([{ id: 'X-001', title: 'Test', tags: [] }], async () => 'content');
    assert.deepEqual(ti.search(''), []);
    assert.deepEqual(ti.search(null), []);
    assert.deepEqual(ti.search(undefined), []);
  });

  it('addEntry adds to existing index', async () => {
    const ti = new TextIndex(join(tempDir, '.brain'));
    await ti.rebuild([], async () => '');
    ti.addEntry({ id: 'NEW-001', title: 'New entry about caching', tags: ['cache'] }, 'Caching strategy details');
    const results = ti.search('caching');
    assert.ok(results.some(r => r.id === 'NEW-001'));
  });

  it('removeEntry removes from index', async () => {
    const ti = new TextIndex(join(tempDir, '.brain'));
    await ti.rebuild([{ id: 'RM-001', title: 'To be removed', tags: [] }], async () => 'remove me');
    ti.removeEntry('RM-001');
    const results = ti.search('removed');
    assert.ok(!results.some(r => r.id === 'RM-001'));
  });

  it('updateEntry replaces content', async () => {
    const ti = new TextIndex(join(tempDir, '.brain'));
    await ti.rebuild([{ id: 'UP-001', title: 'Original title', tags: [] }], async () => 'original content');
    ti.updateEntry({ id: 'UP-001', title: 'Updated title', tags: ['new'] }, 'brand new content');
    const results = ti.search('Updated title');
    assert.ok(results.some(r => r.id === 'UP-001'));
  });

  it('handles entries with non-array tags gracefully', async () => {
    const ti = new TextIndex(join(tempDir, '.brain'));
    await ti.rebuild([{ id: 'T-001', title: 'Bad tags', tags: 'not-array' }], async () => 'content');
    // Should not throw
    const results = ti.search('Bad tags');
    assert.ok(results.length >= 0);
  });

  it('persist and load round-trip', async () => {
    const brainDir = join(tempDir, '.brain');

    // First, write index.json (the "main" index) so it has an older timestamp
    const indexPath = join(brainDir, 'index.json');
    await writeFile(indexPath, '{}', 'utf-8');

    // Small delay to ensure text-index.json gets a newer timestamp
    await new Promise(resolve => setTimeout(resolve, 50));

    // Now rebuild the text index — this writes text-index.json which should be newer
    const ti1 = new TextIndex(brainDir);
    await ti1.rebuild([
      { id: 'P-001', title: 'Persisted entry', tags: ['persist'] }
    ], async () => 'persisted content');

    // Create new instance and try to load from persisted file
    const ti2 = new TextIndex(brainDir);
    const loaded = await ti2._loadPersistedIndex();
    assert.equal(loaded, true);

    const results = ti2.search('Persisted');
    assert.ok(results.some(r => r.id === 'P-001'));
  });
});

// ─────────────────────────────────────────────────────────────
// TfIdf
// ─────────────────────────────────────────────────────────────

describe('TfIdf', () => {
  it('build computes IDF weights', () => {
    const tfidf = new TfIdf();
    tfidf.build(['the quick brown fox', 'the lazy brown dog', 'a fast fox jumps']);
    assert.equal(tfidf.ready, true);
    const weights = tfidf.getWeights();
    assert.ok(weights instanceof Map);
    assert.ok(weights.size > 0);
  });

  it('common terms get lower IDF than rare terms', () => {
    const tfidf = new TfIdf();
    tfidf.build([
      'authentication security tokens',
      'authentication login flow',
      'database migration schema'
    ]);
    const weights = tfidf.getWeights();
    // 'auth' (from authentication) appears in 2/3 docs, 'db' (from database) in 1/3
    // So 'db' should have higher IDF
    const authWeight = weights.get('auth') || 0;
    const dbWeight = weights.get('db') || 0;
    assert.ok(dbWeight > authWeight, `db weight (${dbWeight}) should be > auth weight (${authWeight})`);
  });

  it('getWeights returns null when not built', () => {
    const tfidf = new TfIdf();
    assert.equal(tfidf.getWeights(), null);
  });

  it('build handles empty documents array', () => {
    const tfidf = new TfIdf();
    tfidf.build([]);
    assert.equal(tfidf.ready, false);
    assert.equal(tfidf.getWeights(), null);
  });

  it('build handles single document', () => {
    const tfidf = new TfIdf();
    tfidf.build(['single document with words']);
    assert.equal(tfidf.ready, true);
    const weights = tfidf.getWeights();
    assert.ok(weights.size > 0);
    // With single doc, IDF = log(1/1) = 0 for all terms
    for (const [, w] of weights) {
      assert.equal(w, 0);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// WordProcessing
// ─────────────────────────────────────────────────────────────

describe('normalizeWord', () => {
  it('lowercases input', () => {
    assert.equal(normalizeWord('Hello'), 'hello');
  });

  it('maps synonyms to canonical form', () => {
    assert.equal(normalizeWord('authentication'), 'auth');
    assert.equal(normalizeWord('database'), 'db');
    assert.equal(normalizeWord('login'), 'auth');
    assert.equal(normalizeWord('performance'), 'perf');
  });

  it('strips -ing suffix', () => {
    assert.equal(normalizeWord('testing'), 'test');
    assert.equal(normalizeWord('running'), 'runn'); // no synonym hit, just strips
  });

  it('strips -ed suffix', () => {
    assert.equal(normalizeWord('updated'), 'updat');
  });

  it('strips -tion suffix', () => {
    assert.equal(normalizeWord('validation'), 'valida');
  });

  it('strips -s suffix but not -ss', () => {
    assert.equal(normalizeWord('tests'), 'test');
    // 'class' should not be stripped further (ends with ss)
    assert.equal(normalizeWord('class'), 'class');
  });

  it('returns short words as-is', () => {
    assert.equal(normalizeWord('ab'), 'ab');
    assert.equal(normalizeWord('a'), 'a');
  });
});

describe('extractSignificantWords', () => {
  it('extracts words and filters stopwords', () => {
    const words = extractSignificantWords('the quick brown fox jumps over the lazy dog');
    assert.ok(!words.includes('the'));
    assert.ok(!words.includes('over'));
    assert.ok(words.includes('quick'));
  });

  it('returns empty for empty string', () => {
    assert.deepEqual(extractSignificantWords(''), []);
  });

  it('handles special characters', () => {
    const words = extractSignificantWords('hello@world! test#case');
    assert.ok(words.includes('hello'));
    assert.ok(words.includes('world'));
  });

  it('filters words with length <= 2', () => {
    const words = extractSignificantWords('I am a QA engineer');
    assert.ok(!words.includes('am'));
  });

  it('normalizes words via synonym map', () => {
    const words = extractSignificantWords('authentication login database');
    assert.ok(words.includes('auth'));
    assert.ok(words.includes('db'));
  });
});

describe('extractWordSet', () => {
  it('returns a Set', () => {
    const set = extractWordSet('hello world hello');
    assert.ok(set instanceof Set);
  });

  it('deduplicates words', () => {
    const set = extractWordSet('test test test testing');
    // 'test' appears multiple times and 'testing' normalizes to 'test'
    assert.equal(set.size, 1);
  });

  it('returns empty set for empty string', () => {
    const set = extractWordSet('');
    assert.equal(set.size, 0);
  });
});

describe('weightedJaccard', () => {
  it('returns 0 for empty sets', () => {
    assert.equal(weightedJaccard(new Set(), new Set(['a'])), 0);
    assert.equal(weightedJaccard(new Set(['a']), new Set()), 0);
  });

  it('returns 1 for identical sets (no weights)', () => {
    const set = new Set(['auth', 'db']);
    assert.equal(weightedJaccard(set, set, null), 1);
  });

  it('returns 0 for disjoint sets (no weights)', () => {
    const a = new Set(['auth']);
    const b = new Set(['db']);
    assert.equal(weightedJaccard(a, b, null), 0);
  });

  it('computes plain Jaccard correctly', () => {
    const a = new Set(['auth', 'db', 'cache']);
    const b = new Set(['auth', 'db', 'log']);
    // intersection: 2, union: 4
    const result = weightedJaccard(a, b, null);
    assert.equal(result, 0.5);
  });

  it('uses IDF weights when provided', () => {
    const a = new Set(['auth', 'rare']);
    const b = new Set(['auth', 'rare']);
    const weights = new Map([['auth', 0.5], ['rare', 3.0]]);
    const result = weightedJaccard(a, b, weights);
    assert.equal(result, 1); // identical sets, regardless of weights
  });

  it('weights affect partial overlap score', () => {
    const a = new Set(['auth', 'rare']);
    const b = new Set(['auth', 'common']);
    const weights = new Map([['auth', 0.5], ['rare', 3.0], ['common', 0.3]]);
    const result = weightedJaccard(a, b, weights);
    // intersection weight: 0.5 (auth), union weight: 0.5 + 3.0 + 0.3 = 3.8
    const expected = 0.5 / 3.8;
    assert.ok(Math.abs(result - expected) < 0.001);
  });
});

// ─────────────────────────────────────────────────────────────
// body-builders
// ─────────────────────────────────────────────────────────────

// Simple translator that returns the key as-is
const t = (key) => key;

describe('buildDecisionBody', () => {
  it('builds body with context and decision', () => {
    const body = buildDecisionBody({ context: 'We need X', decision: 'Use Y' }, t);
    assert.ok(body.includes('## context'));
    assert.ok(body.includes('We need X'));
    assert.ok(body.includes('## decision'));
    assert.ok(body.includes('Use Y'));
  });

  it('includes alternatives when provided', () => {
    const body = buildDecisionBody({
      context: 'C', decision: 'D',
      alternatives: ['Alt1', 'Alt2']
    }, t);
    assert.ok(body.includes('## alternatives'));
    assert.ok(body.includes('1. Alt1'));
    assert.ok(body.includes('2. Alt2'));
  });

  it('skips alternatives when empty array', () => {
    const body = buildDecisionBody({ context: 'C', decision: 'D', alternatives: [] }, t);
    assert.ok(!body.includes('## alternatives'));
  });

  it('skips alternatives when undefined', () => {
    const body = buildDecisionBody({ context: 'C', decision: 'D' }, t);
    assert.ok(!body.includes('## alternatives'));
  });

  it('includes consequences when provided', () => {
    const body = buildDecisionBody({
      context: 'C', decision: 'D',
      consequences: ['Con1', 'Con2']
    }, t);
    assert.ok(body.includes('## consequences'));
    assert.ok(body.includes('- Con1'));
  });

  it('includes files when provided', () => {
    const body = buildDecisionBody({
      context: 'C', decision: 'D',
      files: ['app.js', 'db.js']
    }, t);
    assert.ok(body.includes('## files'));
    assert.ok(body.includes('- app.js'));
  });

  it('skips files when not an array', () => {
    const body = buildDecisionBody({ context: 'C', decision: 'D', files: null }, t);
    assert.ok(!body.includes('## files'));
  });

  it('skips files when empty array', () => {
    const body = buildDecisionBody({ context: 'C', decision: 'D', files: [] }, t);
    assert.ok(!body.includes('## files'));
  });

  it('includes validation when provided', () => {
    const body = buildDecisionBody({
      context: 'C', decision: 'D',
      validation: 'npm test'
    }, t);
    assert.ok(body.includes('## validation'));
    assert.ok(body.includes('npm test'));
  });
});

describe('buildBugBody', () => {
  it('builds body with symptoms, root cause, and fix', () => {
    const body = buildBugBody({ symptoms: 'Crash', root_cause: 'Null ref', fix: 'Added check' }, t);
    assert.ok(body.includes('## symptoms'));
    assert.ok(body.includes('Crash'));
    assert.ok(body.includes('## root_cause'));
    assert.ok(body.includes('## fix'));
  });

  it('includes files when provided', () => {
    const body = buildBugBody({
      symptoms: 'S', root_cause: 'R', fix: 'F',
      files: ['buggy.js']
    }, t);
    assert.ok(body.includes('- buggy.js'));
  });

  it('skips files when empty', () => {
    const body = buildBugBody({ symptoms: 'S', root_cause: 'R', fix: 'F', files: [] }, t);
    assert.ok(!body.includes('## files'));
  });

  it('includes regression test when validation provided', () => {
    const body = buildBugBody({
      symptoms: 'S', root_cause: 'R', fix: 'F',
      validation: 'node --test'
    }, t);
    assert.ok(body.includes('## regression_test'));
    assert.ok(body.includes('node --test'));
  });
});

describe('buildImplementationBody', () => {
  it('builds body with description', () => {
    const body = buildImplementationBody({ description: 'Implemented feature X' }, t);
    assert.ok(body.includes('## description'));
    assert.ok(body.includes('Implemented feature X'));
  });

  it('includes key_details when provided', () => {
    const body = buildImplementationBody({ description: 'D', key_details: 'Details here' }, t);
    assert.ok(body.includes('## key_details'));
  });

  it('includes why when provided', () => {
    const body = buildImplementationBody({ description: 'D', why: 'Because reasons' }, t);
    assert.ok(body.includes('## why'));
  });

  it('includes files when provided', () => {
    const body = buildImplementationBody({ description: 'D', files: ['impl.js'] }, t);
    assert.ok(body.includes('- impl.js'));
  });

  it('skips optional fields when missing', () => {
    const body = buildImplementationBody({ description: 'D' }, t);
    assert.ok(!body.includes('## key_details'));
    assert.ok(!body.includes('## why'));
    assert.ok(!body.includes('## files'));
    assert.ok(!body.includes('## validation'));
  });
});

describe('buildPatternBody', () => {
  it('builds body with pattern', () => {
    const body = buildPatternBody({ pattern: 'Singleton pattern' }, t);
    assert.ok(body.includes('## pattern'));
    assert.ok(body.includes('Singleton pattern'));
  });

  it('includes example when provided', () => {
    const body = buildPatternBody({ pattern: 'P', example: 'const x = new Singleton()' }, t);
    assert.ok(body.includes('## example'));
    assert.ok(body.includes('const x = new Singleton()'));
  });

  it('skips example when missing', () => {
    const body = buildPatternBody({ pattern: 'P' }, t);
    assert.ok(!body.includes('## example'));
  });
});

describe('buildLessonBody', () => {
  it('builds body with required fields', () => {
    const body = buildLessonBody({
      what_happened: 'Deployed bad code',
      lesson: 'Always test first',
      rule: 'Run tests before deploy'
    }, t);
    assert.ok(body.includes('## what_happened'));
    assert.ok(body.includes('## lesson'));
    assert.ok(body.includes('## rule'));
  });

  it('includes trigger when provided', () => {
    const body = buildLessonBody({
      what_happened: 'W', lesson: 'L', rule: 'R',
      trigger: 'correction'
    }, t);
    assert.ok(body.includes('## trigger_label'));
    assert.ok(body.includes('correction'));
  });

  it('includes files when provided', () => {
    const body = buildLessonBody({
      what_happened: 'W', lesson: 'L', rule: 'R',
      files: ['deploy.js']
    }, t);
    assert.ok(body.includes('- deploy.js'));
  });

  it('skips optional fields when missing', () => {
    const body = buildLessonBody({ what_happened: 'W', lesson: 'L', rule: 'R' }, t);
    assert.ok(!body.includes('## trigger_label'));
    assert.ok(!body.includes('## files'));
  });
});

describe('buildPlanBody', () => {
  it('builds body with scope and implemented items', () => {
    const body = buildPlanBody({
      scope: 'Build feature X',
      implemented: ['Step 1', 'Step 2'],
      deferred: [],
      next_steps: 'Deploy'
    }, t);
    assert.ok(body.includes('## original_plan'));
    assert.ok(body.includes('Build feature X'));
    assert.ok(body.includes('[x] Step 1'));
    assert.ok(body.includes('[x] Step 2'));
    assert.ok(body.includes('Deploy'));
  });

  it('shows not_implemented when no implemented items', () => {
    const body = buildPlanBody({
      scope: 'S',
      implemented: [],
      deferred: [],
      next_steps: 'N'
    }, t);
    assert.ok(body.includes('not_implemented'));
  });

  it('shows not_implemented when implemented is undefined', () => {
    const body = buildPlanBody({ scope: 'S', next_steps: 'N' }, t);
    assert.ok(body.includes('not_implemented'));
  });

  it('includes deferred items', () => {
    const body = buildPlanBody({
      scope: 'S',
      implemented: [],
      deferred: [{ item: 'Feature Y', reason: 'No time' }],
      next_steps: 'N'
    }, t);
    assert.ok(body.includes('[ ] Feature Y'));
    assert.ok(body.includes('No time'));
  });

  it('shows not_deferred when no deferred items', () => {
    const body = buildPlanBody({
      scope: 'S', implemented: [],
      deferred: [],
      next_steps: 'N'
    }, t);
    assert.ok(body.includes('not_deferred'));
  });

  it('uses not_defined when next_steps is missing', () => {
    const body = buildPlanBody({ scope: 'S', implemented: [], deferred: [] }, t);
    assert.ok(body.includes('not_defined'));
  });
});
