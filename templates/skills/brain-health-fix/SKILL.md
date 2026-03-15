---
name: brain-health-fix
description: Automatically fixes safe brain health issues (broken links, missing bidirectional relations) and reports decisions requiring user input.
---

# Brain Health Fix Skill

Automatically fixes safe brain health issues and reports those requiring user decisions.

## When to Use
- When `brain_health` reports issues
- At the start of a session if overview shows health warnings
- Periodically as maintenance (weekly recommended)

## Steps

### 1. Diagnose
```
brain_health
```
Categorize issues:

**Auto-fixable (do these immediately):**
- Missing bidirectional links → `brain_link_entries`
- Entries not reviewed > 30 days → `brain_review_entry` (mark as reviewed if still valid)

**Needs investigation:**
- Broken links → check if target was renamed/deleted
- Active decisions without implementations → check if impl exists but isn't linked

**Needs user decision:**
- Stale entries → ask user: remove, update, or keep?
- Orphaned entries → ask user: add relationships or archive?
- Old open bugs → ask user: still relevant?

### 2. Auto-Fix

For **missing bidirectional links**:
```
brain_link_entries from=X to=Y rel=relates_to
```

For **old but still valid entries**:
```
brain_review_entry id=DEC-001 notes="Still valid, reviewed during health fix"
```

For **broken links** where target was renamed:
```
brain_update_entry id=X add_related=[{id: "NEW_ID", rel: "supersedes"}]
```

### 3. Report
Present to user:
```
## Auto-Fixed
- ✅ Added bidirectional link: DEC-001 ↔ IMPL-003
- ✅ Reviewed: DEC-002 (still valid)

## Needs Your Decision
- ⚠️ BUG-001 "Login issue" — open for 90 days. Still relevant?
- ⚠️ DEC-005 "Use GraphQL" — no implementation linked. Implemented or abandoned?
```

## Guidelines
- **Never delete entries automatically** — only user can decide to remove
- **Never change status automatically** — only mark as reviewed
- Fix broken links by suggesting the most likely correct target
- Be conservative: when in doubt, report rather than auto-fix
