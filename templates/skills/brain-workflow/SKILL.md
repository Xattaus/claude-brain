---
name: brain-workflow
description: Autonomous context management. Activate whenever Claude works with code and context management is needed — recording decisions, bugs, implementations, patterns, and plans into the .brain/ database via MCP tools.
---

# Brain Workflow — Autonomous Context Management

This project uses an **MCP-based context management system** (the `.brain/` directory).
Use **MCP tools only** — do NOT read .brain/ files directly.

## At session start

1. `brain_get_overview` → project state + health warnings
2. `brain_get_backlog` → incomplete plans and deferred tasks
3. Evaluate whether any deferred task is now relevant

## Before changes

1. `brain_check_conflicts` → check for conflicts with existing decisions
2. `brain_get_context_for_files` → fetch context related to the files

**If brain_check_conflicts returns CONFLICT:**
- STOP and inform the user
- Explain which decision conflicts
- Ask whether the user wants to override, update, or cancel

## After changes — ALWAYS record

| Change type | Tool |
|---|---|
| Architecture decision | `brain_record_decision` (record WHY) |
| Bug fix | `brain_record_bug` (symptoms, root cause, fix) |
| Significant implementation | `brain_record_implementation` |
| Reusable pattern | `brain_record_pattern` |
| Plan | `brain_record_plan` (implemented, deferred, next steps) |

Link entries: `brain_link_entries` (implements, fixes, supersedes, etc.)

## Relationships

- `supersedes` / `superseded_by` — new replaces old
- `implements` — implementation fulfills a decision
- `fixes` — fix resolves a bug
- `caused_by` / `used_in` / `relates_to`

## At session end

If work is incomplete: `brain_record_plan` saves what was done, deferred, and the next steps.

## Search & retrieval

- `brain_search` — by keywords
- `brain_list` — by type/status
- `brain_get_entry` — a single entry
- `brain_health` — health report

## Agents

Use the brain agents **automatically** when the situation calls for it:
- `brain-curator` — health issues
- `brain-documenter` — undocumented changes
- `brain-reviewer` — consistency checks
- `brain-backlog` — backlog management
