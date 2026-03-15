<div align="center">

```
     ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
    ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
    ██║     ██║     ███████║██║   ██║██║  ██║█████╗
    ██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
    ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝
    ██████╗ ██████╗  █████╗ ██╗███╗   ██╗
    ██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║
    ██████╔╝██████╔╝███████║██║██╔██╗ ██║
    ██╔══██╗██╔══██╗██╔══██║██║██║╚██╗██║
    ██████╔╝██║  ██║██║  ██║██║██║ ╚████║
    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝
```

**Persistent memory for AI coding agents**

Your agent forgets everything between sessions. This fixes that.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiByeD0iNCIgZmlsbD0iIzQ0OCIvPjx0ZXh0IHg9IjEyIiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtc2l6ZT0iMTIiPk08L3RleHQ+PC9zdmc+)](https://modelcontextprotocol.io)
![Tools](https://img.shields.io/badge/MCP_Tools-34-ff6b6b)
![Version](https://img.shields.io/badge/version-3.0.0-blue)

</div>

---

<br>

## The Problem

AI coding agents are stateless. Every session starts from zero.

```
Session 1:  "Let's use JWT for auth"     ─── decision made
Session 2:  "Let's use session cookies"  ─── decision contradicted
Session 3:  "Why is auth broken?"        ─── bug reintroduced
```

Architecture decisions get contradicted. Fixed bugs come back. The agent makes the same mistakes over and over because it has no memory.

## The Solution

Claude Brain is an MCP server that gives your agent a **structured knowledge base** it reads on startup and writes to as it works.

```
Session 1:  "Let's use JWT for auth"     ─── brain_record_decision ✓
Session 2:  "Let's use session cookies"  ─── brain_check_conflicts ⚠ CONFLICT with DEC-001
Session 3:  "Fix the auth bug"           ─── brain_get_context_for_files → knows full history
```

<br>

## Quick Start

```bash
git clone https://github.com/Xattaus/claude-brain.git
cd claude-brain && npm install

# Install into your project
node install.js /path/to/your/project
```

That's it. The installer configures the MCP server, adds hooks, and injects instructions into your `CLAUDE.md`. The agent starts using the brain automatically.

<br>

## How It Works

The brain stores knowledge as Markdown files with YAML frontmatter, linked together in a typed knowledge graph:

```
.brain/
├── overview.md              Project description
├── index.json               Fast lookup index
├── decisions/               Architecture Decision Records
│   ├── DEC-001-use-jwt.md
│   └── DEC-002-postgres.md
├── implementations/         What was built and how
├── bugs/                    Root causes and fixes
├── patterns/                Reusable conventions
├── lessons/                 Mistakes and rules to prevent them
└── history/
    └── changelog.md         Full change log
```

Entries link to each other with typed relationships — `implements`, `fixes`, `supersedes`, `caused_by` — forming a navigable graph of project knowledge.

<br>

## Cognitive Firewall

The brain doesn't just store knowledge — it **actively protects** your codebase.

```
                    ┌─────────────────────┐
                    │   Agent wants to    │
                    │   edit a file       │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  brain_preflight()  │
                    │  ┌───────────────┐  │
                    │  │ Check context │  │
                    │  │ Check conflicts│  │
                    │  │ Check lessons │  │
                    │  │ Check rules   │  │
                    │  └───────┬───────┘  │
                    └─────────┼───────────┘
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
           ┌──────────┐ ┌──────────┐ ┌──────────┐
           │ LOW  <40 │ │ MED 40-69│ │ HIGH ≥70 │
           │ Proceed  │ │ Careful  │ │  STOP    │
           └──────────┘ └──────────┘ └──────────┘
                                          │
                                          ▼
                                    Ask the user
```

After edits, `brain_validate_change()` verifies nothing was violated. If it fails — revert.

<br>

## 34 MCP Tools

<details>
<summary><b>Core — Query & Discovery</b> <kbd>5 tools</kbd></summary>
<br>

| Tool | What it does |
|:-----|:-------------|
| `brain_get_overview` | Project overview + active decisions + open bugs. Call at session start. |
| `brain_search` | Full-text search across all entries with relevance ranking |
| `brain_get_entry` | Retrieve a single entry by ID with content and relationships |
| `brain_list` | List entries filtered by type, status, and tags |
| `brain_get_lessons` | Get active lessons grouped by severity |

</details>

<details>
<summary><b>Recording — Capture Knowledge</b> <kbd>5 tools</kbd></summary>
<br>

| Tool | What it does |
|:-----|:-------------|
| `brain_record_decision` | Architecture decisions in ADR format |
| `brain_record_bug` | Bug fixes with symptoms, root cause, and fix |
| `brain_record_implementation` | Implementation details and code changes |
| `brain_record_pattern` | Reusable patterns and conventions |
| `brain_record_lesson` | Lessons from mistakes with rules to prevent recurrence |

</details>

<details>
<summary><b>Context & Relationships — Navigate Knowledge</b> <kbd>4 tools</kbd></summary>
<br>

| Tool | What it does |
|:-----|:-------------|
| `brain_link_entries` | Create bidirectional typed links between entries |
| `brain_get_context_for_files` | Get all decisions, bugs, implementations for specific files |
| `brain_traverse_graph` | Navigate knowledge graph — paths, impact analysis, cycles |
| `brain_check_conflicts` | Check if proposed change conflicts with existing decisions |

</details>

<details>
<summary><b>Safety — Cognitive Firewall</b> <kbd>4 tools</kbd></summary>
<br>

| Tool | What it does |
|:-----|:-------------|
| `brain_preflight` | Pre-edit risk assessment with risk score (LOW/MEDIUM/HIGH) |
| `brain_validate_change` | Post-edit validation against brain rules |
| `brain_rebuild_rules` | Rebuild cognitive firewall rule index |
| `brain_restore_snapshot` | Restore brain to a previous snapshot |

</details>

<details>
<summary><b>Planning & Tracking</b> <kbd>4 tools</kbd></summary>
<br>

| Tool | What it does |
|:-----|:-------------|
| `brain_record_plan` | Record session plans with scope and deferred items |
| `brain_update_plan` | Update plan status and mark items completed |
| `brain_get_backlog` | Get all incomplete/deferred plans sorted by priority |
| `brain_get_session_summary` | Summary of all brain changes in current session |

</details>

<details>
<summary><b>Maintenance</b> <kbd>5 tools</kbd></summary>
<br>

| Tool | What it does |
|:-----|:-------------|
| `brain_update_entry` | Update existing entry (status, title, content) |
| `brain_review_entry` | Mark entry as reviewed without changing content |
| `brain_health` | Health report — stale entries, orphans, broken links |
| `brain_get_history` | Full change history log |
| `brain_auto_document` | Analyze git commits and suggest undocumented changes |

</details>

<details>
<summary><b>Advanced</b> <kbd>7 tools</kbd></summary>
<br>

| Tool | What it does |
|:-----|:-------------|
| `brain_mine_sessions` | Extract context from past Claude Code sessions |
| `brain_coordinate_team` | Run brain agents (curator, documenter, reviewer, backlog) |
| `brain_rebuild_index` | Rebuild index.json from files (repair corrupted state) |
| `brain_get_metrics` | Usage metrics — tool calls, entries created, activity |
| `brain_create_snapshot` | Create backup of current brain state |
| `brain_list_snapshots` | List available snapshots for restore |
| `brain_update` | Upgrade Brain to latest version |

</details>

<br>

## Self-Improvement Loop

When the agent makes a mistake or the user corrects it, the brain records a **lesson** with a concrete rule that prevents recurrence:

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐
│ User corrects│────▶│ brain_record_    │────▶│ Next session:      │
│ the agent    │     │ lesson()         │     │ brain_get_lessons()│
└──────────────┘     │                  │     │ reads the rule     │
                     │ severity: high   │     │ before working     │
                     │ rule: "Never..." │     └────────────────────┘
                     └──────────────────┘
```

Lessons are checked during `brain_preflight()` — if a proposed edit would violate a learned rule, the firewall blocks it.

<br>

## CLI

Use the brain from the command line without an AI agent:

```bash
node cli.js overview                                    # project overview
node cli.js search "authentication"                     # full-text search
node cli.js search --type=decision "database"           # filtered search
node cli.js read DEC-001                                # read single entry
node cli.js check "Switch JWT to session cookies"       # conflict check
node cli.js decide "Use Postgres" "Need RDBMS" "v14"   # record decision
node cli.js log-bug "Login crash" "500 error" "Fixed"   # record bug fix
node cli.js implement "Auth API" "Added /api/auth"      # record implementation
node cli.js link IMPL-005 DEC-002 implements            # link entries
```

<br>

## 3D Visualizer

Interactive neural map of your project's knowledge graph:

```bash
node visualize.js /path/to/your/project
```

Opens a browser with a force-directed 3D graph — nodes colored by type, links showing relationships, with zoom/pan/rotate controls.

<br>

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP Server                           │
│                      mcp-server.js                          │
│                     (34 tools exposed)                      │
├─────────────┬──────────────┬──────────────┬─────────────────┤
│ Brain       │ Search       │ Graph        │ Conflict        │
│ Manager     │              │              │ Checker         │
│             │ Two-phase    │ Typed        │ Three-stage     │
│ CRUD +      │ scoring +    │ relationships│ detection       │
│ file locks  │ MiniSearch   │ + traversal  │                 │
├─────────────┼──────────────┼──────────────┼─────────────────┤
│ Change      │ Rule Index   │ Analyzer     │ Auto            │
│ Validator   │              │              │ Documenter      │
│             │ Cognitive    │ Project      │                 │
│ Post-edit   │ firewall     │ structure    │ Git commit      │
│ validation  │ rules        │ analysis     │ analysis        │
├─────────────┴──────────────┴──────────────┴─────────────────┤
│                     .brain/ directory                       │
│            Markdown + YAML frontmatter + index.json         │
└─────────────────────────────────────────────────────────────┘
```

<br>

## Testing

```bash
npm test                    # run all tests
npm run test:brain          # core brain operations
npm run test:graph          # knowledge graph traversal
npm run test:validation     # input validation (Zod)
npm run test:perf           # performance benchmarks
```

Uses Node.js built-in test runner (`node:test`) — no additional test dependencies needed.

<br>

## Project Structure

```
claude-brain/
├── mcp-server.js           MCP server — all 34 tools
├── install.js              One-command installer for any project
├── cli.js                  Command-line interface
├── visualize.js            3D knowledge graph visualizer
├── lib/
│   ├── brain-manager.js    Core CRUD with file locking
│   ├── search.js           MiniSearch-powered full-text search
│   ├── graph.js            Knowledge graph traversal
│   ├── conflict-checker.js Decision conflict detection
│   ├── change-validator.js Post-edit rule validation
│   ├── rule-index.js       Cognitive firewall rule engine
│   ├── analyzer.js         Project structure analysis
│   ├── schemas.js          Zod input validation
│   └── ...
├── templates/
│   ├── CLAUDE.md.template  Instructions injected into target projects
│   ├── hooks/              Session hooks (start, stop, firewall, etc.)
│   ├── agents/             Bundled agent definitions
│   └── skills/             Brain workflow skills
└── tests/
    ├── brain.test.js       Core operations
    ├── graph.test.js       Graph traversal
    ├── validation.test.js  Schema validation
    └── performance.test.js Benchmarks
```

<br>

---

<div align="center">

**MIT License** · Built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) · Compatible with any MCP client

</div>
