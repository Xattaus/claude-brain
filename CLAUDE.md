# Project Brain (Autonomous Context Management)

This project uses an autonomous context management system with 52 MCP tools.
The brain lives in the `.brain/` directory and is accessed via MCP tools.
Code structure analysis lives in `.brain/code-graph/` using tree-sitter AST parsing.

## COGNITIVE FIREWALL — Automatic Protection

### BEFORE editing files (MANDATORY)
Call `brain_preflight` BEFORE editing any file:
```
brain_preflight({ files: ["path/to/file.js"], intent: "what you plan to do" })
```

- RISK >= 70 (HIGH): **STOP**, inform the user, ask for permission
- RISK >= 40 (MEDIUM): Read all rules carefully before proceeding
- RISK < 40 (LOW/SAFE): Proceed, but follow all rules

**NEVER** skip DONT or GUARD rules.

### AFTER editing (significant changes)
```
brain_validate_change({ files: [...], change_description: "...", changes_summary: "..." })
```
If FAIL: **REVERT** or ask the user.

## Mandatory Instructions

### At session start
1. Call `brain_get_overview` to get the project overview
2. Call `brain_get_lessons` to review learned lessons — DO NOT repeat past mistakes
3. DO NOT read .brain/ files directly — use MCP tools

### While working
1. **Before changes**: Call `brain_check_conflicts` to check for conflicts
2. **File context**: Call `brain_get_context_for_files` to get all decisions, bugs, implementations, and patterns related to the files
3. **Searching**: Use `brain_search` or `brain_list` — NOT grep on .brain/
4. **Details**: Use `brain_get_entry` for a single entry

### After changes — ALWAYS save to brain
1. **Architecture decision** → `brain_record_decision` (record WHY)
2. **Bug fix** → `brain_record_bug` (symptoms, root cause, fix)
3. **New implementation / significant change** → `brain_record_implementation`
4. **Reusable pattern** → `brain_record_pattern`
5. **Lesson from mistake** → `brain_record_lesson` (what happened, lesson, rule)
6. **Create links** → `brain_link_entries` between entries (implements, fixes, supersedes, etc.)

### Self-Improvement Loop
When the user corrects you or you discover a mistake:
1. **ALWAYS** record a lesson with `brain_record_lesson`
2. Write a concrete **rule** that prevents the same mistake from recurring
3. Set severity: `high` = critical error, `medium` = normal, `low` = best practice
4. Set trigger: `correction` = user corrected, `discovery` = self-discovered, `bug` = via bug, `review` = during review

### Relationships

Entries can be linked with typed relationships:
- `supersedes` / `superseded_by` — new decision replaces old one
- `implements` — implementation fulfills a decision
- `fixes` — bug fix resolves a bug
- `caused_by` — caused by another entry
- `used_in` — used in another entry
- `relates_to` — general relationship

Use `brain_link_entries` to create a relationship — it automatically creates a bidirectional link.

### Conflict warnings
If `brain_check_conflicts` returns matches:
- **STOP** and inform the user before proceeding
- Explain which previous decision conflicts and why
- Ask if the user wants to override, update, or cancel the change
- Critical/high-priority bugs are escalated to CONFLICT level (not just WARNING)

## Code Graph — Automatic Code Structure Analysis

The brain includes a code graph system that uses tree-sitter to parse source code ASTs and build a knowledge graph of symbols, dependencies, and relationships.

### When to use code graph tools
- **Understanding code structure**: `brain_code_query` — search for symbols, files, or concepts
- **Before refactoring**: `brain_code_blast` — check blast radius of changes to files
- **Finding dependencies**: `brain_code_neighbors` — get imports/exports/calls for a symbol
- **Navigating code**: `brain_code_path` — find shortest path between two symbols
- **Code health**: `brain_code_gods` — find god nodes (over-connected symbols needing refactoring)
- **Architecture insights**: `brain_code_surprises` — find unexpected cross-module/cross-language edges

### Code Graph tools (13)
| Tool | Purpose |
|------|---------|
| `brain_code_build` | Build/rebuild the code graph from source files |
| `brain_code_query` | Search the graph with IDF-weighted token-budgeted results |
| `brain_code_node` | Get details for a specific node by ID |
| `brain_code_neighbors` | Get incoming/outgoing edges for a node |
| `brain_code_path` | Find shortest path between two nodes |
| `brain_code_community` | Get nodes in a detected community cluster |
| `brain_code_stats` | Get graph statistics (nodes, edges, languages, types) |
| `brain_code_blast` | Compute blast radius for changed files |
| `brain_code_gods` | Find god nodes (P99 degree, refactoring candidates) |
| `brain_code_surprises` | Find surprising/unexpected edges |
| `brain_code_health` | Check if graph is built and up to date |
| `brain_bridge` | Manually link a brain entry to a code graph node |
| `brain_bridge_auto` | Auto-detect bridges between brain entries and code nodes |

### Supported languages
JavaScript, TypeScript, Python, Rust (tree-sitter WASM parsers in `lib/code-graph/wasm/`)

## .brain/ directory structure
- `overview.md` — Project overview (compact)
- `decisions/` — Architecture Decision Records (ADR format)
- `implementations/` — Implementation descriptions
- `bugs/` — Bug fixes and workarounds
- `patterns/` — Reusable patterns
- `lessons/` — Lessons learned from mistakes and corrections
- `history/changelog.md` — Change history
- `code-graph/` — Code structure graph data (auto-generated)
