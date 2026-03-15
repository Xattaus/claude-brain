# Claude Brain

Autonomous context management system for AI coding agents. An MCP server that gives Claude Code (and other MCP-compatible agents) persistent, structured project memory across sessions.

Instead of starting every session from scratch, your AI agent remembers architecture decisions, bug fixes, learned lessons, and implementation details — and uses them to avoid repeating mistakes.

## Why

AI coding agents lose all context between sessions. This means:
- The same bugs get reintroduced
- Architecture decisions are forgotten and contradicted
- Lessons learned vanish after the conversation ends

Claude Brain solves this by providing a structured knowledge base that the agent reads at session start and writes to as it works.

## Features

- **34 MCP tools** for reading, writing, searching, and navigating project knowledge
- **Cognitive Firewall** — pre-edit risk scoring (`brain_preflight`) and post-edit validation (`brain_validate_change`) to prevent rule violations
- **Conflict detection** — warns when a proposed change contradicts an existing decision or known bug
- **Knowledge graph** — typed relationships between entries (implements, fixes, supersedes, caused_by, etc.)
- **Self-improvement loop** — records lessons from mistakes with severity and concrete rules to prevent recurrence
- **Health monitoring** — detects stale entries, orphan nodes, broken links, and circular references
- **Session hooks** — reminds the agent to load context at start and save work at end
- **CLI tool** — use the brain from the command line without an AI agent
- **3D Visualizer** — interactive neural map of your project's knowledge graph

## Quick Start

### Install into an existing project

```bash
# Clone this repo
git clone https://github.com/Xattaus/claude-brain.git

# Install dependencies
cd claude-brain
npm install

# Install brain into your project
node install.js /path/to/your/project
```

The installer will:
1. Create a `.brain/` directory in your project
2. Configure the MCP server in your project's MCP config
3. Add brain instructions to your project's `CLAUDE.md`
4. Install session hooks and agent templates

### Verify

```bash
# Start the MCP server manually (usually done automatically by Claude Code)
BRAIN_PROJECT_PATH=/path/to/your/project node mcp-server.js
```

## MCP Tools

### Core (5)
| Tool | Description |
|------|-------------|
| `brain_get_overview` | Project overview + active decisions + open bugs |
| `brain_search` | Full-text search with relevance ranking |
| `brain_get_entry` | Retrieve a single entry by ID |
| `brain_list` | List entries filtered by type, status, tags |
| `brain_get_lessons` | Get lessons grouped by severity |

### Recording (5)
| Tool | Description |
|------|-------------|
| `brain_record_decision` | Architecture decisions (ADR format) |
| `brain_record_bug` | Bug fixes with root cause and symptoms |
| `brain_record_implementation` | Implementation details and code changes |
| `brain_record_pattern` | Reusable patterns and conventions |
| `brain_record_lesson` | Lessons from mistakes and corrections |

### Context & Relationships (4)
| Tool | Description |
|------|-------------|
| `brain_link_entries` | Create bidirectional typed links |
| `brain_get_context_for_files` | Get all knowledge related to specific files |
| `brain_traverse_graph` | Navigate knowledge graph (paths, impact, cycles) |
| `brain_check_conflicts` | Check for conflicts with existing decisions |

### Safety (4)
| Tool | Description |
|------|-------------|
| `brain_preflight` | Pre-edit risk assessment (LOW/MEDIUM/HIGH) |
| `brain_validate_change` | Post-edit validation against brain rules |
| `brain_rebuild_rules` | Rebuild cognitive firewall rule index |
| `brain_restore_snapshot` | Restore brain to a previous snapshot |

### Planning (4)
| Tool | Description |
|------|-------------|
| `brain_record_plan` | Record session plans with scope and deferred items |
| `brain_update_plan` | Update plan status |
| `brain_get_backlog` | Get incomplete/deferred plans by priority |
| `brain_get_session_summary` | Summary of all changes in current session |

### Maintenance (5)
| Tool | Description |
|------|-------------|
| `brain_update_entry` | Update existing entry |
| `brain_review_entry` | Mark entry as reviewed |
| `brain_health` | Health report (stale, orphans, broken links) |
| `brain_get_history` | Change history log |
| `brain_auto_document` | Suggest undocumented changes from git |

### Advanced (7)
| Tool | Description |
|------|-------------|
| `brain_mine_sessions` | Extract context from past Claude Code sessions |
| `brain_coordinate_team` | Run brain agents (curator, documenter, reviewer) |
| `brain_rebuild_index` | Repair corrupted index from files |
| `brain_get_metrics` | Usage metrics and activity stats |
| `brain_create_snapshot` | Backup current brain state |
| `brain_list_snapshots` | List available snapshots |
| `brain_update` | Upgrade Brain to latest version |

## CLI Usage

```bash
# Project overview
node cli.js overview

# Search
node cli.js search "authentication"
node cli.js search --type=decision "database"

# Read a specific entry
node cli.js read DEC-001

# Check for conflicts before making changes
node cli.js check "Switch from JWT to session cookies"

# Record a decision
node cli.js decide "Use PostgreSQL" "Need relational database" "Deploy Postgres 14"

# Record a bug fix
node cli.js log-bug "Login crash on empty password" "Server returns 500" "Added validation check"

# Record an implementation
node cli.js implement "User Profile API" "Added GET /api/me and PUT /api/me endpoints"

# Link entries
node cli.js link IMPL-005 DEC-002 implements
```

## Visualizer

Interactive 3D neural map of your project's knowledge graph:

```bash
node visualize.js /path/to/your/project
```

Opens a browser with nodes for each entry, colored by type, with relationship links between them.

## How It Works

The brain stores knowledge as Markdown files with YAML frontmatter in a `.brain/` directory:

```
.brain/
  overview.md          # Project description
  index.json           # Entry index for fast lookups
  decisions/           # Architecture Decision Records
  implementations/     # Implementation details
  bugs/                # Bug fixes and workarounds
  patterns/            # Reusable patterns
  lessons/             # Lessons learned from mistakes
  history/changelog.md # Change log
```

Each entry has typed relationships to other entries, forming a navigable knowledge graph. The cognitive firewall uses rules extracted from decisions and lessons to score the risk of proposed changes before they happen.

## Architecture

- **MCP Server** (`mcp-server.js`) — Exposes 34 tools via the Model Context Protocol
- **Brain Manager** (`lib/brain-manager.js`) — Core CRUD with file locking (no race conditions)
- **Search** (`lib/search.js`) — Two-phase scoring with MiniSearch + boost heuristics
- **Graph** (`lib/graph.js`) — Typed relationship network with traversal algorithms
- **Conflict Checker** (`lib/conflict-checker.js`) — Three-stage conflict detection
- **Change Validator** (`lib/change-validator.js`) — Post-edit rule validation
- **Rule Index** (`lib/rule-index.js`) — Cognitive firewall rule extraction and matching
- **Analyzer** (`lib/analyzer.js`) — Project structure analysis for brain initialization
- **Installer** (`install.js`) — One-command setup for any project

## License

MIT
