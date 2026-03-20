#!/usr/bin/env node

/**
 * Brain MCP Server — Autonomous context management for AI coding agents
 *
 * 35 tools organized in categories:
 *   Core (5):     overview, search, get_entry, list, get_lessons
 *   Recording (5): record_decision, record_bug, record_implementation, record_pattern, record_lesson
 *   Context (4):  link_entries, get_context_for_files, traverse_graph, check_conflicts
 *   Safety (4):   preflight, validate_change, rebuild_rules, restore_snapshot
 *   Planning (4): record_plan, update_plan, get_backlog, get_session_summary
 *   Maintenance (5): update_entry, review_entry, health, get_history, auto_document
 *   Advanced (8): visualize, mine_sessions, coordinate_team, rebuild_index,
 *                 get_metrics, create_snapshot, list_snapshots, update
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrainManager } from './lib/brain-manager.js';
import { BrainSearch } from './lib/search.js';
import { ConflictChecker } from './lib/conflict-checker.js';
import { getTranslator } from './lib/i18n.js';
import { BrainMetrics } from './lib/metrics.js';
import { validateToolArgs } from './lib/schemas.js';
import { HANDLERS } from './lib/handlers/index.js';
import { SessionTracker } from './lib/utils/session-tracker.js';
import { TfIdf } from './lib/tfidf.js';

// ── MCP Protocol helpers ──

// Shared message queue with persistent buffer
const messageQueue = [];
let messageBuffer = '';
let messageWaiter = null;

function initStdin() {
  process.stdin.on('data', (chunk) => {
    messageBuffer += chunk.toString();

    while (true) {
      const newlineIdx = messageBuffer.indexOf('\n');
      if (newlineIdx === -1) break;

      const line = messageBuffer.substring(0, newlineIdx).trim();
      messageBuffer = messageBuffer.substring(newlineIdx + 1);

      if (line.length > 0) {
        try {
          const msg = JSON.parse(line);
          if (messageWaiter) {
            const resolve = messageWaiter;
            messageWaiter = null;
            resolve(msg);
          } else {
            messageQueue.push(msg);
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }
  });

  process.stdin.on('end', () => {
    if (messageWaiter) {
      const resolve = messageWaiter;
      messageWaiter = null;
      resolve(null);
    }
  });
}

function readMessage() {
  if (messageQueue.length > 0) {
    return Promise.resolve(messageQueue.shift());
  }
  return new Promise((resolve) => {
    messageWaiter = resolve;
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(json + '\n');
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── Relation types (for schema enum) ──

const RELATION_TYPES = ['supersedes', 'superseded_by', 'caused_by', 'implements', 'fixes', 'used_in', 'relates_to'];

// ── Tool definitions ──

const TOOLS = [
  {
    name: 'brain_get_overview',
    description: 'Get project overview — call at session start for context. Returns overview.md + active decisions + open bugs. Set max_tokens to limit output size.',
    inputSchema: {
      type: 'object',
      properties: {
        compact: { type: 'boolean', description: 'Compact output (headers + IDs only, no content). Default: false' },
        max_tokens: { type: 'number', description: 'Approximate max output length in characters. Prioritizes: health warnings > decisions > bugs > overview text.' }
      },
      required: []
    }
  },
  {
    name: 'brain_search',
    description: 'Search all brain entries by text query, type, and/or tags. Results ranked by relevance with freshness/status/connection boosts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (words to match)' },
        type: { type: 'string', enum: ['decision', 'bug', 'implementation', 'pattern', 'plan', 'lesson'], description: 'Filter by entry type' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        compact: { type: 'boolean', description: 'Compact output (IDs + titles only). Default: false' }
      },
      required: ['query']
    }
  },
  {
    name: 'brain_get_entry',
    description: 'Get a single brain entry by its ID (e.g. "DEC-001", "BUG-003"). Shows content and relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Entry ID (e.g. DEC-001, BUG-003)' }
      },
      required: ['id']
    }
  },
  {
    name: 'brain_list',
    description: 'List brain entries filtered by type, status, and/or tags.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'bug', 'implementation', 'pattern', 'plan', 'lesson'] },
        status: { type: 'string', description: 'Filter by status (active, fixed, open, current, etc.)' },
        tags: { type: 'array', items: { type: 'string' } },
        compact: { type: 'boolean', description: 'Compact output (IDs + titles only). Default: false' }
      }
    }
  },
  {
    name: 'brain_record_decision',
    description: 'Record a new architecture decision (ADR). Use after making significant design choices.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Decision title' },
        context: { type: 'string', description: 'Why this decision was needed' },
        decision: { type: 'string', description: 'What was decided' },
        alternatives: { type: 'array', items: { type: 'string' }, description: 'Considered alternatives' },
        consequences: { type: 'array', items: { type: 'string' }, description: 'Consequences of the decision' },
        tags: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' }, description: 'Affected files' },
        related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID (e.g. DEC-001)' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          },
          description: 'Related entries with relation types'
        },
        supersedes: { type: 'string', description: 'ID of decision this supersedes (e.g. DEC-001). Auto-creates supersedes relation.' },
        validation: { type: 'string', description: 'Verifiable success criteria — command or test to validate this decision (e.g. "npm test", "curl /api/health")' }
      },
      required: ['title', 'context', 'decision']
    }
  },
  {
    name: 'brain_record_bug',
    description: 'Record a bug fix or workaround. Use after fixing or discovering a bug.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Bug title' },
        symptoms: { type: 'string', description: 'What was observed' },
        root_cause: { type: 'string', description: 'Root cause of the bug' },
        fix: { type: 'string', description: 'How it was fixed' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        status: { type: 'string', enum: ['open', 'fixed', 'wont-fix', 'workaround'], default: 'fixed' },
        tags: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' }, description: 'Affected files' },
        related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          },
          description: 'Related entries with relation types'
        },
        validation: { type: 'string', description: 'Regression test command to verify the fix (e.g. "npm test -- --grep save-bug")' }
      },
      required: ['title', 'symptoms', 'root_cause', 'fix']
    }
  },
  {
    name: 'brain_record_implementation',
    description: 'Record an implementation detail. Use after significant code changes.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Implementation title' },
        description: { type: 'string', description: 'What was implemented' },
        key_details: { type: 'string', description: 'Key parameters, thresholds, etc.' },
        why: { type: 'string', description: 'Why this approach was chosen' },
        tags: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' }, description: 'Affected files' },
        related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          },
          description: 'Related entries with relation types'
        },
        validation: { type: 'string', description: 'Command or test to verify this implementation works (e.g. "node test-feature.js")' }
      },
      required: ['title', 'description']
    }
  },
  {
    name: 'brain_record_pattern',
    description: 'Record a reusable pattern or convention. Use when discovering patterns worth reusing.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Pattern title' },
        pattern: { type: 'string', description: 'Pattern description' },
        example: { type: 'string', description: 'Code example' },
        tags: { type: 'array', items: { type: 'string' } },
        related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          },
          description: 'Related entries with relation types'
        }
      },
      required: ['title', 'pattern']
    }
  },
  {
    name: 'brain_record_lesson',
    description: 'Record a lesson learned from a mistake, correction, or discovery. Use after ANY user correction or when discovering important patterns. Lessons are reviewed at session start.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short lesson title (e.g. "Älä käytä force-push ilman tarkistusta")' },
        what_happened: { type: 'string', description: 'What went wrong or what was discovered' },
        lesson: { type: 'string', description: 'The extracted lesson — what should be done differently' },
        rule: { type: 'string', description: 'A concrete, actionable rule to follow (e.g. "Always ask before force-push")' },
        trigger: { type: 'string', enum: ['correction', 'discovery', 'bug', 'review'], description: 'How the lesson was learned' },
        severity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How important this lesson is (default: medium)' },
        tags: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' }, description: 'Related files' },
        related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          },
          description: 'Related entries'
        }
      },
      required: ['title', 'what_happened', 'lesson', 'rule']
    }
  },
  {
    name: 'brain_get_lessons',
    description: 'Get all active lessons for session start review. Returns lessons grouped by severity (high → medium → low). Call at session start alongside brain_get_overview.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Filter by severity' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        compact: { type: 'boolean', description: 'Compact output (rules only). Default: false' }
      }
    }
  },
  {
    name: 'brain_check_conflicts',
    description: 'Check if a proposed change conflicts with existing decisions or bugs. CALL BEFORE making significant changes. Critical/high bugs = CONFLICT, others = WARNING.',
    inputSchema: {
      type: 'object',
      properties: {
        proposed_change: { type: 'string', description: 'Description of the proposed change' },
        affected_files: { type: 'array', items: { type: 'string' }, description: 'Files that will be modified' }
      },
      required: ['proposed_change']
    }
  },
  {
    name: 'brain_update_entry',
    description: 'Update an existing brain entry (status, title, content, relationships).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Entry ID to update' },
        status: { type: 'string', description: 'New status' },
        title: { type: 'string', description: 'New title' },
        content: { type: 'string', description: 'New body content (replaces existing)' },
        add_related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          },
          description: 'Relations to add (appended to existing)'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'brain_get_history',
    description: 'Get the brain change history log.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'ISO date string to filter from (e.g. "2026-02-01")' },
        limit: { type: 'number', description: 'Max entries to return (default 20)' }
      }
    }
  },
  {
    name: 'brain_link_entries',
    description: 'Create a typed bidirectional link between two brain entries. Inverse relation is added automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source entry ID (e.g. IMPL-002)' },
        to: { type: 'string', description: 'Target entry ID (e.g. DEC-001)' },
        rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type (e.g. implements, supersedes, fixes)' }
      },
      required: ['from', 'to', 'rel']
    }
  },
  {
    name: 'brain_get_context_for_files',
    description: 'Get all brain context for given files — decisions, bugs, implementations, patterns. Follows related links (1 level) and supersedes chains.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'File paths to get context for' },
        compact: { type: 'boolean', description: 'Compact output (IDs + titles only, use brain_get_entry for details). Default: false' }
      },
      required: ['files']
    }
  },
  {
    name: 'brain_health',
    description: 'Get brain health report — stale entries, orphans, broken links, missing bidirectional relations, incomplete plans, old open bugs.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold_days: { type: 'number', description: 'Days before an entry is considered stale (default: 30)' }
      }
    }
  },
  {
    name: 'brain_review_entry',
    description: 'Mark a brain entry as reviewed without changing its content. Updates last_reviewed timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Entry ID to review (e.g. DEC-001)' },
        notes: { type: 'string', description: 'Optional review notes (e.g. "still valid", "needs update soon")' }
      },
      required: ['id']
    }
  },
  {
    name: 'brain_record_plan',
    description: 'Record a session plan — what was discussed, implemented, deferred, and next steps. CALL AT SESSION END when work is incomplete or items were deferred.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Plan title (e.g. "Phase 2: Recording system")' },
        scope: { type: 'string', description: 'Full plan description — what was discussed and decided' },
        implemented: { type: 'array', items: { type: 'string' }, description: 'What was actually implemented' },
        deferred: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item: { type: 'string', description: 'What was deferred' },
              reason: { type: 'string', description: 'Why it was deferred' }
            },
            required: ['item', 'reason']
          },
          description: 'Items postponed for later with reasons'
        },
        next_steps: { type: 'string', description: 'What should be done next' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Priority level (default: medium)' },
        status: { type: 'string', enum: ['planned', 'in_progress', 'partial', 'completed', 'abandoned'], description: 'Plan status (default: partial)' },
        tags: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' }, description: 'Affected files/directories' },
        related: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Entry ID (e.g. DEC-001)' },
              rel: { type: 'string', enum: RELATION_TYPES, description: 'Relation type' }
            },
            required: ['id', 'rel']
          },
          description: 'Related entries'
        }
      },
      required: ['title', 'scope']
    }
  },
  {
    name: 'brain_get_backlog',
    description: 'Get all incomplete/deferred plans sorted by priority. Shows what was deferred and why.',
    inputSchema: {
      type: 'object',
      properties: {
        include_completed: { type: 'boolean', description: 'Include completed plans (default: false)' },
        compact: { type: 'boolean', description: 'Compact output (priorities + IDs only). Default: false' }
      }
    }
  },
  {
    name: 'brain_update_plan',
    description: 'Update a plan — mark deferred items as completed, add new deferred items, change status or next steps.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Plan ID (e.g. PLAN-001)' },
        completed_items: { type: 'array', items: { type: 'string' }, description: 'Deferred items now completed (matched by substring)' },
        new_deferred: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item: { type: 'string' },
              reason: { type: 'string' }
            },
            required: ['item', 'reason']
          },
          description: 'New items to defer'
        },
        new_implemented: { type: 'array', items: { type: 'string' }, description: 'New items to add to implemented list' },
        status: { type: 'string', enum: ['planned', 'in_progress', 'partial', 'completed', 'abandoned'] },
        next_steps: { type: 'string', description: 'Updated next steps' }
      },
      required: ['id']
    }
  },
  {
    name: 'brain_mine_sessions',
    description:
      'Mine Claude Code conversation logs for context about specific files. ' +
      'Finds past sessions where these files were discussed or modified, and extracts ' +
      'the reasoning, decisions, and context from those conversations. ' +
      'Useful for understanding WHY changes were made when documenting undocumented changes.',
    inputSchema: {
      type: 'object',
      properties: {
        file_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to search for in conversation history (relative or absolute)'
        },
        days_back: {
          type: 'number',
          description: 'How many days back to search (default: 30)'
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional keywords to search for in conversations'
        }
      },
      required: ['file_paths']
    }
  },
  {
    name: 'brain_get_session_summary',
    description: 'Get a summary of all brain changes made during this session. Use before /compact or /clear to preserve context. Also useful for session-end review.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_coordinate_team',
    description: 'Run multiple brain agents (curator, documenter, reviewer, backlog) and collect their results. Useful for comprehensive brain maintenance.',
    inputSchema: {
      type: 'object',
      properties: {
        agents: {
          type: 'array',
          items: { type: 'string', enum: ['curator', 'documenter', 'reviewer', 'backlog'] },
          description: 'Which agents to run (default: all)'
        }
      }
    }
  },
  {
    name: 'brain_rebuild_index',
    description: 'Rebuild index.json from .brain/ files. Use when index is corrupted, entries are missing, or after manual file edits. Scans all entry directories and reconstructs the index from YAML frontmatter.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_get_metrics',
    description: 'Get brain usage metrics: tool calls, entries created, search queries, and activity by day.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_create_snapshot',
    description: 'Create a snapshot/backup of the current brain state. Use before major changes or periodically as safety.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Optional label for this snapshot (e.g., "before-refactoring")' }
      }
    }
  },
  {
    name: 'brain_list_snapshots',
    description: 'List all available brain snapshots for potential restore.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_restore_snapshot',
    description: 'Restore brain to a previous snapshot. Creates a backup of the current state first.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the snapshot to restore (from brain_list_snapshots)' }
      },
      required: ['name']
    }
  },
  {
    name: 'brain_update',
    description: 'UPGRADE Brain tool to latest version. Refreshes hooks, skills, agents, CLAUDE.md template. Call this when user says "päivitä aivot" or "update brain". This does NOT review brain content — it upgrades the software.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_visualize',
    description: 'Launch an interactive knowledge graph visualization of the brain in the browser. Opens a local web server and shows all entries, links, and relationships as a force-directed graph. Use when the user asks to see the brain, visualize the graph, or explore entries visually.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'brain_traverse_graph',
    description: 'Navigate the brain knowledge graph. Modes: traverse (BFS from entry), path (shortest path between entries), impact (what depends on this entry), cycles (find circular references).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['traverse', 'path', 'impact', 'cycles'], description: 'Navigation mode' },
        start_id: { type: 'string', description: 'Starting entry ID (required for traverse/path/impact)' },
        target_id: { type: 'string', description: 'Target entry ID (required for path mode)' },
        max_depth: { type: 'number', description: 'Maximum traversal depth (default: 3, max: 10)' },
        rel_types: { type: 'array', items: { type: 'string', enum: RELATION_TYPES }, description: 'Filter by relation types' }
      },
      required: ['mode']
    }
  },
  {
    name: 'brain_auto_document',
    description: 'Analyze recent git commits and suggest brain entries for undocumented changes. Call at session end to catch documentation gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Git date range (default: "7 days ago") or git ref' },
        dry_run: { type: 'boolean', description: 'If true (default), only show suggestions without creating entries' }
      }
    }
  },
  {
    name: 'brain_preflight',
    description: 'COGNITIVE FIREWALL: Pre-edit check. Combines context, conflicts, lessons, and rules into one call. CALL BEFORE editing any file. Returns risk score + all applicable rules.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Files you are about to modify' },
        intent: { type: 'string', description: 'What you intend to do (optional, enables conflict detection)' }
      },
      required: ['files']
    }
  },
  {
    name: 'brain_validate_change',
    description: 'COGNITIVE FIREWALL: Post-edit validation. Checks if your changes violate any brain rules (GUARD, DONT, DO). Call after significant edits.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Files that were modified' },
        change_description: { type: 'string', description: 'What was changed' },
        changes_summary: { type: 'string', description: 'Detailed summary of changes (optional)' }
      },
      required: ['files', 'change_description']
    }
  },
  {
    name: 'brain_rebuild_rules',
    description: 'Rebuild the cognitive firewall rule index from all brain entries. Use if rules seem outdated or after manual brain file edits.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
];

// ── Tool dispatch ──

async function handleTool(ctx, name, args) {
  try { await ctx.metrics.trackCall(name); } catch { /* non-critical */ }

  const validation = validateToolArgs(name, args);
  if (!validation.success) {
    return [{ type: 'text', text: `${validation.error}` }];
  }
  args = validation.data || args;

  const handler = HANDLERS[name];
  if (!handler) return [{ type: 'text', text: `Unknown tool: ${name}` }];
  return handler(ctx, args);
}

// ── Main MCP loop ──

async function main() {
  const projectPath = process.env.BRAIN_PROJECT_PATH;
  if (!projectPath) {
    process.stderr.write('Error: BRAIN_PROJECT_PATH environment variable not set\n');
    process.exit(1);
  }

  const manager = new BrainManager(projectPath);
  const search = new BrainSearch(manager);
  const checker = new ConflictChecker(manager);
  const metrics = new BrainMetrics(join(projectPath, '.brain'));
  const session = new SessionTracker();

  // Initialize language from manifest
  let t = getTranslator('fi');
  try {
    const manifest = await manager.loadManifest();
    if (manifest.language) {
      t = getTranslator(manifest.language);
    }
  } catch { /* use default fi */ }

  // Build TF-IDF from brain corpus at startup
  const tfidf = new TfIdf();
  try {
    const index = await manager.loadIndex();
    const documents = [];
    for (const entry of index.entries) {
      try {
        const fullPath = join(projectPath, '.brain', entry.path);
        const content = await readFile(fullPath, 'utf-8');
        documents.push(content);
      } catch { /* skip unreadable entries */ }
    }
    tfidf.build(documents);
    process.stderr.write(`[brain] TF-IDF built from ${documents.length} entries\n`);
  } catch { /* non-critical */ }

  // Load rule index from index.json at startup
  try {
    await manager.loadRuleIndex();
    process.stderr.write(`[brain] Rule index loaded\n`);
  } catch { /* non-critical, will rebuild on first use */ }

  // Context object shared by all handlers
  const ctx = { manager, search, checker, metrics, session, t, tfidf };

  process.stderr.write(`Brain MCP server started for: ${projectPath}\n`);

  initStdin();

  // Process messages
  while (true) {
    let msg;
    try {
      msg = await readMessage();
    } catch {
      break;
    }

    if (!msg) break; // stdin closed

    if (!msg.method) {
      if (msg.id) sendResult(msg.id, {});
      continue;
    }

    switch (msg.method) {
      case 'initialize':
        sendResult(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'brain',
            version: '3.0.0'
          }
        });
        break;

      case 'notifications/initialized':
        // No response needed
        break;

      case 'tools/list':
        sendResult(msg.id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const toolName = msg.params?.name;
        const toolArgs = msg.params?.arguments || {};

        try {
          const content = await handleTool(ctx, toolName, toolArgs);
          sendResult(msg.id, { content });
        } catch (error) {
          sendResult(msg.id, {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          });
        }
        break;
      }

      default:
        if (msg.id) {
          sendError(msg.id, -32601, `Method not found: ${msg.method}`);
        }
    }
  }
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
