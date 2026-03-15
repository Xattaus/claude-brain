---
name: auto-document
description: Automatically discovers undocumented code changes by comparing git history against brain entries, and creates missing entries.
---

# Auto-Document Skill

Automatically discovers undocumented code changes and creates brain entries.

## When to Use
- After a coding session where multiple changes were made
- When `brain_health` shows many orphaned entries
- When you notice git commits without corresponding brain entries
- Periodically as a maintenance task

## Steps

1. **Get recent git history**
   ```bash
   git log --oneline -20
   git diff --stat HEAD~5
   ```

2. **Get current brain state**
   - Call `brain_get_overview`
   - Note existing entries and their file associations

3. **Compare and find gaps**
   For each significant commit:
   a. Call `brain_get_context_for_files` with the changed files
   b. If no brain entry covers this change → it's undocumented
   c. Call `brain_mine_sessions` to find conversation context

4. **Create missing entries**
   For each undocumented change:
   - **Architecture decision** → `brain_record_decision`
   - **Bug fix** (commit message has "fix", "bug") → `brain_record_bug`
   - **New feature** (new files) → `brain_record_implementation`
   - **Refactoring** → `brain_record_implementation` with "refactoring" tag

5. **Link related entries**
   - `brain_link_entries` to connect new entries with existing ones
   - Use `implements`, `fixes`, `supersedes` as appropriate

## Tips
- Focus on WHY changes were made, not just WHAT changed
- Include alternatives considered if conversation context reveals them
- Skip trivial changes (formatting, comments, dependency bumps)
- Group related file changes into a single entry
