import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SuperpowersSync } from '../lib/integrations/superpowers-sync.js';

describe('SuperpowersSync — parseSpecFile', () => {
  it('extracts title, date, and summary from a spec markdown file', () => {
    const content = `# Kauppa Stripe Paitavalitsin Design

## Summary
Stripe-integraatio kauppaan ja paitavalitsimen UI.

## Architecture
- Frontend: React + shadcn
- Backend: API routes

## Components
- PaymentForm
- JerseySelector
`;

    const result = SuperpowersSync.parseSpecFile(content, '2026-04-15-kauppa-stripe-paitavalitsin-design.md');

    assert.equal(result.title, 'Kauppa Stripe Paitavalitsin Design');
    assert.equal(result.date, '2026-04-15');
    assert.ok(result.summary.length <= 500);
    assert.ok(result.summary.includes('Stripe'));
    assert.deepEqual(result.tags, ['source:superpowers-spec']);
  });

  it('extracts title from filename when no heading found', () => {
    const content = 'Some content without a heading\n\nMore content here.';
    const result = SuperpowersSync.parseSpecFile(content, '2026-04-20-my-feature-design.md');

    assert.equal(result.title, 'my-feature-design');
    assert.equal(result.date, '2026-04-20');
  });

  it('extracts file paths from content', () => {
    const content = `# Test Design

## Files
- \`src/components/Foo.tsx\`
- \`src/api/bar.rs\`

## Other section
Content here.
`;
    const result = SuperpowersSync.parseSpecFile(content, '2026-05-01-test-design.md');
    assert.deepEqual(result.files, ['src/components/Foo.tsx', 'src/api/bar.rs']);
  });
});

describe('SuperpowersSync — parsePlanFile', () => {
  it('extracts title, date, status from a plan markdown file', () => {
    const content = `# Kauppa Stripe Paitavalitsin

> **For agentic workers:** Use superpowers skill...

**Goal:** Build Stripe integration

---

### Task 1: Setup

- [x] **Step 1: Install deps**
- [x] **Step 2: Configure**

### Task 2: Frontend

- [ ] **Step 1: Build form**
- [ ] **Step 2: Test**
`;

    const result = SuperpowersSync.parsePlanFile(content, '2026-04-15-kauppa-stripe-paitavalitsin.md');

    assert.equal(result.title, 'Kauppa Stripe Paitavalitsin');
    assert.equal(result.date, '2026-04-15');
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.tags, ['source:superpowers-plan']);
  });

  it('detects completed plans (all checkboxes checked)', () => {
    const content = `# Done Plan

### Task 1: Only task
- [x] **Step 1: Done**
- [x] **Step 2: Done**
`;
    const result = SuperpowersSync.parsePlanFile(content, '2026-04-20-done-plan.md');
    assert.equal(result.status, 'completed');
  });

  it('detects planned status (no checkboxes checked)', () => {
    const content = `# New Plan

### Task 1: First task
- [ ] **Step 1: Todo**
- [ ] **Step 2: Todo**
`;
    const result = SuperpowersSync.parsePlanFile(content, '2026-04-20-new-plan.md');
    assert.equal(result.status, 'planned');
  });

  it('extracts file paths from plan content', () => {
    const content = `# Plan With Files

### Task 1: Build
- [ ] Create \`src/auth/handler.rs\`
- [ ] Update \`web/Login.tsx\`
`;
    const result = SuperpowersSync.parsePlanFile(content, '2026-05-01-files-plan.md');
    assert.deepEqual(result.files, ['src/auth/handler.rs', 'web/Login.tsx']);
  });
});

describe('SuperpowersSync — parseSpecFile (additional)', () => {
  it('returns empty files array when no paths found', () => {
    const content = '# No Paths\n\nJust text content with no code references.\n';
    const result = SuperpowersSync.parseSpecFile(content, '2026-05-01-no-paths.md');
    assert.deepEqual(result.files, []);
  });
});
