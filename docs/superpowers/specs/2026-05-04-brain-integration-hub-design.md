# Brain Integration Hub — Design Spec

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Autonomous context management tool (claude-brain v3.0.0)

## Problem Statement

Brain and Claude's native capabilities (superpowers skills, agents, teams) operate as isolated systems:

1. **Superpowers disconnect:** 17+ specs and plans in `docs/superpowers/` are invisible to brain — new sessions start without crucial planning context
2. **Agent/team data loss:** Subagent research, team work results, and process decisions vanish when sessions end
3. **Empty overviews:** Brain's `overview.md` stays empty because no auto-generation exists
4. **No environment awareness:** Brain doesn't know which MCP servers, skills, or agent types are available

**Evidence from Classic AP (live test project):**
- 869 brain entries (159 implementations, 91 bugs, 24 lessons, 20 decisions)
- But only 1 plan in `.brain/plans/` vs 17 superpowers plans in `docs/superpowers/plans/`
- `overview.md` contains only "Classic AP > Projekti" (essentially empty)

## Architecture

### New Modules

```
lib/
├── integrations/
│   ├── sync-engine.js         # Orchestrator: manages all sync sources
│   ├── superpowers-sync.js    # docs/superpowers/ → brain entries
│   ├── environment-scanner.js # MCP, skills, agents → environment.json
│   └── session-integrator.js  # Agent/team data → brain entries
├── auto-overview.js           # Generates overview.md from brain content
```

### Component 1: Sync Engine (`sync-engine.js`)

Central orchestrator that:
- Maintains a sync state file `.brain/sync-state.json` tracking last-synced hashes/timestamps
- Coordinates all sync sources (currently only superpowers, extensible to others)
- Runs automatically when `brain_get_overview` is called
- Can be triggered manually via `brain_sync` tool
- Deduplicates: won't create entries for already-synced files

**Sync state format:**
```json
{
  "version": 1,
  "lastSync": "2026-05-04T12:00:00Z",
  "sources": {
    "superpowers-specs": {
      "files": {
        "docs/superpowers/specs/2026-04-15-kauppa-stripe.md": {
          "hash": "abc123",
          "brainId": "PLAN-002",
          "syncedAt": "2026-05-04T12:00:00Z"
        }
      }
    },
    "superpowers-plans": { ... }
  }
}
```

### Component 2: Superpowers Sync (`superpowers-sync.js`)

**Scan locations:**
- `{projectRoot}/docs/superpowers/specs/*.md`
- `{projectRoot}/docs/superpowers/plans/*.md`

**Parse logic:**
1. Read each markdown file
2. Extract title from first `# ` heading or filename
3. Extract date from filename pattern `YYYY-MM-DD-*`
4. Parse content sections (Summary, Architecture, Components, etc.)
5. Determine if it's a spec (design doc) or plan (implementation plan)

**Mapping to brain entries:**

| Source | Brain type | Brain prefix |
|--------|-----------|--------------|
| `specs/*.md` | plan | PLAN |
| `plans/*.md` | plan | PLAN |

Both map to `plan` type because specs and plans are both planning artifacts. Differentiated by tags:
- Specs get tag `source:superpowers-spec`
- Plans get tag `source:superpowers-plan`

**Entry creation:**
```javascript
{
  type: 'plan',
  prefix: 'PLAN',
  title: extractedTitle,
  frontmatter: {
    status: inferStatus(content), // 'completed' if all checkboxes done, else 'partial'
    priority: 'medium',
    tags: ['source:superpowers-spec', ...extractedTags],
    files: extractFilePaths(content),
    source_file: relativeFilePath
  },
  body: summarizeContent(content)
  // summarizeContent extracts: first paragraph as description,
  // ## headings as structure, checkbox items as task list,
  // max 500 chars total — links to source_file for full content
}
```

**Update logic:** If file hash changed since last sync and brain entry exists → update entry content via `manager.updateEntry()`.

### Component 3: Environment Scanner (`environment-scanner.js`)

**Scans:**

1. **MCP servers:** Read `~/.claude/settings.json` → extract `mcpServers` keys and their configurations
2. **Superpowers skills:** Glob `~/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills/*/` → extract skill names and descriptions from index files
3. **Custom agents:** Glob `{projectRoot}/.claude/agents/*.md` → extract agent names and descriptions
4. **Hooks:** Read `~/.claude/settings.json` → extract hooks configuration

**Storage:** `.brain/environment.json`
```json
{
  "version": 1,
  "scanned": "2026-05-04T12:00:00Z",
  "mcp_servers": [
    { "name": "brain", "description": "Autonomous context management", "tools_count": 35 },
    { "name": "playwright", "description": "Browser automation" },
    { "name": "context7", "description": "Library documentation" }
  ],
  "skills": [
    { "name": "brainstorming", "description": "Collaborative design exploration" },
    { "name": "writing-plans", "description": "Implementation plan creation" },
    { "name": "tdd", "description": "Test-driven development" }
  ],
  "custom_agents": [
    { "name": "code-reviewer", "file": ".claude/agents/code-reviewer.md" }
  ],
  "hooks": {
    "PreToolUse": ["..."],
    "PostToolUse": ["..."]
  }
}
```

**Tool:** `brain_get_environment` returns this data. `brain_scan_environment` forces a rescan.

### Component 4: Session Integrator (`session-integrator.js`)

**New entry type:** `research`

Records exploration process data that helps future sessions understand WHY decisions were made:

```markdown
---
id: RES-001
type: research
title: "Party AP matchmaking: ELO vs MMR tutkimus"
date: 2026-05-04
status: completed
tags: [matchmaking, research]
related: [{ id: "DEC-021", rel: "caused_by" }]
---

## Tutkitut vaihtoehdot
1. **ELO-pohjainen** — Yksinkertainen, toimii 1v1:ssä
2. **TrueSkill/MMR** — Parempi tiimeille, monimutkaisempi
3. **Glicko-2** — Luotettavuusväli mukana

## Hylätyt ja miksi
- TrueSkill: Liian monimutkainen Classic AP:n kontekstiin
- Glicko-2: Vaatii säännöllisiä pelejä luotettavuuden ylläpitoon

## Lopputulos
ELO valittu → DEC-021

## Agenttidata
- Researcher-agentti tutki 3 paperia aiheesta
- Benchmark-tulokset: ELO converge 30 pelissä, TrueSkill 15 pelissä
```

**Tool:** `brain_record_research` — tallentaa tutkimusprosessin
**Fields:** title, alternatives (array), rejected_reasons (array), conclusion, agent_data, tags, files, related

### Component 5: Auto-Overview (`auto-overview.js`)

**Triggers:**
- Called by `brain_get_overview` when overview is empty or stale (> 7 days since last generation AND new entries exist since then)
- Checks `overview.md` for `<!-- manual -->` tag → if present, skips auto-generation

**Generation algorithm:**

1. **Project name:** From manifest
2. **Description:** Synthesize from top 5 most-connected decisions + most recent implementations
3. **Tech stack:** Analyze `files` fields across all entries → detect languages/frameworks:
   - `.rs` → Rust
   - `.tsx/.ts` → TypeScript/React
   - `.py` → Python
   - etc.
4. **Architecture:** Extract component names from decisions and implementations
5. **Active development:** Last 5 implementations + open/partial plans
6. **Critical rules:** Top 5 high-severity lessons

**Output format:**
```markdown
# {Project Name}

> {Auto-generated description}

## Tech Stack
- Rust (backend, bots)
- TypeScript/React (web frontend)
- SQLite (database)

## Architecture
- **RoomBot** — Game room management
- **MatchManager** — Matchmaking and ELO
- **AnalyzerBot** — Game analytics and xG
- **Web API** — REST endpoints
- **Frontend** — Player profiles, stats

## Active Development
- IMPL-159: Latest implementation...
- PLAN-001: AnalyzerBot (completed)

## Critical Rules (from lessons)
- LES-005: Server uses Latin-1, no UTF-8
- LES-004: Flood protection kicks after 2 rapid messages
- ...

---
*Auto-generated {date} from {N} brain entries. Add `<!-- manual -->` to override.*
```

### New MCP Tools Summary

| Tool | Category | Description |
|------|----------|-------------|
| `brain_sync` | Maintenance | Manual sync: docs/superpowers/ → brain entries |
| `brain_get_environment` | Core | Return environment info (MCPs, skills, agents) |
| `brain_scan_environment` | Maintenance | Force rescan of environment |
| `brain_record_research` | Recording | Record research process (alternatives, rejections, findings) |

### Modified Existing Tools

| Tool | Change |
|------|--------|
| `brain_get_overview` | Auto-triggers sync + auto-overview generation when stale |
| `brain_record_plan` | New optional field `source_file` to link to superpowers doc |
| `brain_update_plan` | New optional field `research_notes` for process context |
| `brain_list` | New type filter value: `research` |
| `brain_search` | Indexes research entries |

## CLAUDE.md Changes

The generated CLAUDE.md template should be updated to include:

```markdown
### At session start
1. Call `brain_get_overview` to get the project overview (auto-syncs superpowers docs)
2. Call `brain_get_lessons` to review learned lessons
3. Call `brain_get_backlog` to see incomplete plans
4. Call `brain_get_environment` to know available tools/skills/agents
```

## Testing Strategy

### Unit Tests

1. **superpowers-sync.js:**
   - Parse spec markdown → extract title, date, sections
   - Parse plan markdown → extract title, status, items
   - Detect changed files (hash comparison)
   - Skip already-synced files
   - Handle malformed/missing files gracefully

2. **sync-engine.js:**
   - Orchestrate full sync cycle
   - Load/save sync state
   - Deduplicate entries
   - Handle first-run (no sync state)

3. **environment-scanner.js:**
   - Parse MCP server config
   - Discover superpowers skills
   - Find custom agents
   - Handle missing directories gracefully

4. **session-integrator.js:**
   - Create research entry from alternatives/rejections
   - Link research to decisions
   - Validate research entry schema

5. **auto-overview.js:**
   - Generate overview from entries
   - Detect tech stack from file extensions
   - Respect `<!-- manual -->` tag
   - Handle empty brain gracefully
   - Freshness check (> 7 days + new entries)

### Integration Tests

6. **Full sync flow:**
   - Write spec file to docs/ → call brain_sync → verify brain entry created
   - Modify spec → re-sync → verify entry updated
   - Delete spec → re-sync → verify entry status updated

7. **Overview auto-generation:**
   - Empty brain → minimal overview
   - Rich brain (mock Classic AP data) → full overview with all sections
   - Manual override respected

8. **Environment scan + overview:**
   - Scan environment → overview includes tool recommendations

### Regression Tests

9. **All 189 existing tests must pass**
10. **Existing brain_get_overview behavior preserved when no superpowers docs exist**
11. **Existing brain_record_plan works unchanged**

### Live Validation (Classic AP)

12. **Retroactive sync:** All 17 Classic AP superpowers specs synced to brain
13. **Auto-overview:** Generated overview for Classic AP is accurate and useful
14. **Environment scan:** Correctly identifies brain MCP + other tools

## Implementation Order

1. `sync-engine.js` + `superpowers-sync.js` (core sync infrastructure)
2. `auto-overview.js` (depends on sync for fresh data)
3. `environment-scanner.js` (independent)
4. `session-integrator.js` + `brain_record_research` tool (independent)
5. Integration into `brain_get_overview` (ties everything together)
6. CLAUDE.md template update
7. Tests for all components
8. Live validation against Classic AP

## Non-Goals

- Modifying superpowers skills themselves (they remain independent)
- Real-time file watching (sync is triggered, not continuous)
- Storing full spec/plan content in brain (only summaries + links)
- Supporting non-superpowers external tools in v1 (architecture allows future extension)
