# Project Brain (Autonomous Context Management)

This project uses an autonomous context management system with 53 MCP tools.
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
1. Call `brain_get_overview` to get the project overview (auto-syncs superpowers docs + auto-generates overview if stale)
2. Call `brain_get_lessons` to review learned lessons — DO NOT repeat past mistakes
3. Call `brain_get_backlog` to see incomplete plans and deferred tasks
4. Call `brain_get_environment` to know available tools, skills, and agents
5. Evaluate if any deferred task is now relevant
6. DO NOT read .brain/ files directly — use MCP tools

### While working
1. **Before changes**: Call `brain_check_conflicts` to check for conflicts with existing decisions
2. **File context**: Call `brain_get_context_for_files` to get all decisions, bugs, implementations, and patterns related to the files you're editing
3. **Searching**: Use `brain_search` or `brain_list` — NOT grep on .brain/
4. **Details**: Use `brain_get_entry` for a single entry

### Research and exploration
When evaluating multiple approaches before making a decision:
1. Call `brain_record_research` with alternatives explored, rejected options, and conclusion
2. Link the research entry to the resulting decision with `brain_link_entries`

### After changes — ALWAYS save to brain
1. **Architecture decision** → `brain_record_decision` (record WHY this choice was made)
2. **Bug fix** → `brain_record_bug` (symptoms, root cause, fix)
3. **New implementation / significant change** → `brain_record_implementation`
4. **Reusable pattern** → `brain_record_pattern`
5. **Lesson from mistake** → `brain_record_lesson` (what happened, lesson, rule)
6. **Research process** → `brain_record_research` (alternatives, rejections, conclusion)
7. **Plan** → `brain_record_plan` (what was planned, done, deferred)
8. **Create links** → `brain_link_entries` between entries (implements, fixes, supersedes, etc.)

### Self-Improvement Loop
When the user corrects you or you discover a mistake:
1. **ALWAYS** record a lesson with `brain_record_lesson`
2. Write a concrete **rule** that prevents the same mistake from recurring
3. Set severity: `high` = critical error, `medium` = normal, `low` = best practice
4. Set trigger: `correction` = user corrected, `discovery` = self-discovered, `bug` = via bug, `review` = during review

### At session end — save plans!
If work is incomplete or tasks were deferred:
1. Call `brain_record_plan` to save the plan, completed parts, and deferred tasks
2. Clearly mark WHY each item was deferred
3. Record next steps
4. Use `brain_update_plan` to update an existing plan

### Health monitoring
- `brain_health` — health report (stale entries, orphans, broken links)
- `brain_review_entry` — mark entry as reviewed without changing content

### Updates and maintenance
- **"Update brain"** → call `brain_update` — updates the Brain tool to the latest version (hooks, skills, agents, CLAUDE.md). Does NOT mean reviewing content.
- `brain_create_snapshot` — create backup before major changes
- `brain_list_snapshots` / `brain_restore_snapshot` — list/restore backups
- `brain_get_metrics` — usage statistics
- `brain_rebuild_index` — repair corrupted index.json

### Relationships

Entries can be linked with typed relationships:
- `supersedes` / `superseded_by` — new decision replaces old one
- `implements` — implementation fulfills a decision
- `fixes` — bug fix resolves a bug
- `caused_by` — caused by another entry
- `used_in` — used in another entry
- `relates_to` — general relationship

Use `brain_link_entries` to create a relationship — it automatically creates a bidirectional link.
When recording a new decision, you can use the `supersedes` parameter to replace an old decision.

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

### Code Graph tools (14)
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
| `brain_code_visualize` | Launch interactive code graph visualizer in browser |
| `brain_bridge` | Manually link a brain entry to a code graph node |
| `brain_bridge_auto` | Auto-detect bridges between brain entries and code nodes |

### Supported languages
JavaScript, TypeScript, Python, Rust (tree-sitter WASM parsers)

## .brain/ directory structure
- `overview.md` — Project overview (compact)
- `decisions/` — Architecture Decision Records (ADR format)
- `implementations/` — Implementation descriptions
- `bugs/` — Bug fixes and workarounds
- `patterns/` — Reusable patterns
- `lessons/` — Lessons learned from mistakes and corrections
- `research/` — Research processes (alternatives, rejections, conclusions)
- `plans/` — Plans and deferred tasks
- `history/changelog.md` — Change history
- `code-graph/` — Code structure graph data (auto-generated)

## Bundled agents — use proactively!

This project includes specialized agents for brain management. Use them **automatically** without asking the user when the situation calls for it:

### brain-curator — Brain health maintainer
- **When**: Run at session start if `brain_health` reports issues (stale, orphans, broken links)
- **Triggers**: Health warnings in overview, >5 stale entries, broken links

### brain-documenter — Undocumented change detector
- **When**: Run automatically when the user requests code changes and git history shows previously undocumented changes
- **Triggers**: New session start if previous session had changes, user requests "update documentation"
- Uses `brain_mine_sessions` to extract conversation context

### brain-reviewer — Consistency validator
- **When**: Run when brain entries seem outdated or user reports "brain doesn't match code"
- **Triggers**: Major refactoring done, many stale entries, user questions brain reliability

### brain-backlog — Backlog manager
- **When**: Run at session start if `brain_get_backlog` returns open plans
- **Triggers**: >3 incomplete plans, deferred task now relevant, user asks "what should I do next"

### architect — System architect
- **When**: Use when user requests a new feature, major refactoring, or architecture change
- **Triggers**: "design", "how would I implement", new module/component, major structural change
- READ-ONLY — plans but does not implement. Produces architecture diagrams, API design, data models, and implementation plans

### code-reviewer — Code reviewer
- **When**: Use automatically after significant code changes or when user requests a review
- **Triggers**: Large PR/change ready, user requests "review code", new feature implemented, before committing critical code
- Checks for bugs, security vulnerabilities, performance issues, and code quality

### test-writer — Test writer
- **When**: Use when new code needs tests or user requests test writing
- **Triggers**: New feature implemented without tests, user requests "write tests", bug fix needing a regression test
- Automatically detects the project's test framework and follows existing test conventions

### security-scanner — Security auditor
- **When**: Use when code handles authentication, input, secrets, or external integrations
- **Triggers**: Auth changes, API endpoints, dependency updates, user requests "check security", new external integration
- Scans for OWASP Top 10 vulnerabilities, hardcoded secrets, known dependency vulnerabilities

### General rules
- **DO NOT** ask permission to run agents — they are part of normal workflow
- Report results to the user concisely, do not show raw agent output
- If an agent finds issues, suggest fixes and implement them if they are straightforward

## Recent brain entries (auto-updated)

<!-- BRAIN_RECENT_START -->
_No entries yet._
<!-- BRAIN_RECENT_END -->
