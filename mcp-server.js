#!/usr/bin/env node

/**
 * Brain MCP Server — Autonominen kontekstinhallinta Claude Codelle
 *
 * Provides 24+ tools for managing project knowledge:
 * - brain_get_overview, brain_search, brain_get_entry, brain_list
 * - brain_record_decision, brain_record_bug, brain_record_implementation, brain_record_pattern
 * - brain_check_conflicts, brain_update_entry, brain_get_history
 * - brain_link_entries, brain_get_context_for_files
 * - brain_health, brain_review_entry
 * - brain_record_plan, brain_get_backlog, brain_update_plan
 * - brain_mine_sessions, brain_get_session_summary
 * - brain_preflight, brain_validate_change, brain_rebuild_rules (Cognitive Firewall)
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrainManager } from './lib/brain-manager.js';
import { BrainSearch } from './lib/search.js';
import { ConflictChecker } from './lib/conflict-checker.js';
import { mineProjectContext } from './lib/conversation-miner.js';
import { getTranslator } from './lib/i18n.js';
import { BrainMetrics } from './lib/metrics.js';
import { validateToolArgs } from './lib/schemas.js';
import { BrainGraph } from './lib/graph.js';
import { AutoDocumenter } from './lib/auto-documenter.js';
import { calculateRiskScore, riskLabel } from './lib/rule-index.js';
import { ChangeValidator } from './lib/change-validator.js';

// Language translator — initialized in main() from manifest
let t = getTranslator('fi');

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

// ── Session tracking ──

const sessionChanges = [];

function trackSessionChange(type, id, title) {
  sessionChanges.push({
    timestamp: new Date().toISOString(),
    type,
    id,
    title
  });
}

// ── Tool handlers ──

async function handleTool(manager, search, checker, metrics, name, args) {
  // Track tool call in metrics
  try { await metrics.trackCall(name); } catch { /* non-critical */ }

  // Validate arguments against Zod schemas
  const validation = validateToolArgs(name, args);
  if (!validation.success) {
    return [{ type: 'text', text: `❌ ${validation.error}` }];
  }
  // Use validated (and default-filled) data
  args = validation.data || args;

  switch (name) {
    case 'brain_get_overview': {
      const compact = args.compact || false;
      const overview = await manager.getOverview();
      const manifest = await manager.loadManifest();
      const decisions = await manager.listEntries({ type: 'decision', status: 'active' });
      const openBugs = await manager.listEntries({ type: 'bug', status: 'open' });
      const activeLessons = await manager.listEntries({ type: 'lesson', status: 'active' });

      let result = '';

      if (compact) {
        // Compact: first 500 chars of overview only
        result += overview.substring(0, 500) + (overview.length > 500 ? '\n...(truncated, call without compact for full)' : '') + '\n\n';
      } else {
        result += overview + '\n\n';
      }

      // Show project paths from manifest
      if (manifest.paths && manifest.paths.length > 1) {
        result += '## Projektisijainnit\n';
        for (const { path, label } of manifest.paths) {
          result += `- **${label}**: \`${path}\`\n`;
        }
        result += '\n';
      }

      if (decisions.length > 0) {
        result += '## Active Decisions\n';
        for (const d of decisions) {
          result += `- **${d.id}**: ${d.title}\n`;
        }
        result += '\n';
      }
      if (openBugs.length > 0) {
        result += '## Open Bugs\n';
        for (const b of openBugs) {
          result += `- **${b.id}**: ${b.title}\n`;
        }
        result += '\n';
      }
      if (activeLessons.length > 0) {
        result += `## Lessons (${activeLessons.length})\n`;
        result += '_Call brain_get_lessons for full rules._\n';
        for (const l of activeLessons) {
          result += `- **${l.id}**: ${l.title}\n`;
        }
        result += '\n';
      }

      // Health warnings (always included even in compact)
      try {
        const health = await manager.getHealthData(30);
        const warnings = [];
        if (health.stale.length > 0) warnings.push(`\u26a0 ${health.stale.length} stale entries`);
        if (health.orphaned.length > 0) warnings.push(`\u26a0 ${health.orphaned.length} orphans`);
        if (health.brokenLinks.length > 0) warnings.push(`\u274c ${health.brokenLinks.length} broken links`);
        if (health.oldOpenBugs.length > 0) warnings.push(`\u26a0 ${health.oldOpenBugs.length} old open bugs`);

        if (warnings.length > 0) {
          result += '## Health Warnings\n';
          for (const w of warnings) {
            result += `- ${w}\n`;
          }
          result += 'Run `brain_health` for details.\n\n';
        }

        // Backlog summary
        const incompletePlans = health.incompletePlans || [];
        if (incompletePlans.length > 0) {
          const byPrio = {};
          for (const p of incompletePlans) {
            const prio = p.priority || 'medium';
            byPrio[prio] = (byPrio[prio] || 0) + 1;
          }
          const prioSummary = Object.entries(byPrio).map(([k, v]) => `${v} ${k}`).join(', ');
          result += '## Backlog\n';
          result += `- ${incompletePlans.length} incomplete plans (${prioSummary})\n`;
          result += 'Run `brain_get_backlog` for details.\n\n';
        }
      } catch {
        // Health check failed silently
      }
      // Token-aware truncation: if max_tokens is set, trim intelligently
      const maxTokens = args.max_tokens;
      if (maxTokens && result.length > maxTokens) {
        // Priority: health warnings > decisions > bugs > backlog > overview text
        // Rebuild result with budget allocation
        const sections = [];

        // Health warnings always get full space (highest priority)
        let healthSection = '';
        try {
          const health = await manager.getHealthData(30);
          const warnings = [];
          if (health.stale.length > 0) warnings.push(`⚠ ${health.stale.length} stale entries`);
          if (health.brokenLinks.length > 0) warnings.push(`❌ ${health.brokenLinks.length} broken links`);
          if (warnings.length > 0) {
            healthSection = '## Health Warnings\n' + warnings.map(w => `- ${w}`).join('\n') + '\n\n';
          }
        } catch { /* skip */ }

        const decisionsSection = decisions.length > 0
          ? '## Active Decisions\n' + decisions.map(d => `- **${d.id}**: ${d.title}`).join('\n') + '\n\n'
          : '';
        const bugsSection = openBugs.length > 0
          ? '## Open Bugs\n' + openBugs.map(b => `- **${b.id}**: ${b.title}`).join('\n') + '\n\n'
          : '';

        // Allocate remaining budget to overview text
        const fixedLen = healthSection.length + decisionsSection.length + bugsSection.length;
        const overviewBudget = Math.max(100, maxTokens - fixedLen);
        const truncatedOverview = overview.substring(0, overviewBudget) +
          (overview.length > overviewBudget ? '\n...(truncated, call without max_tokens for full)' : '');

        result = truncatedOverview + '\n\n' + healthSection + decisionsSection + bugsSection;
      }

      return [{ type: 'text', text: result }];
    }

    case 'brain_search': {
      const compact = args.compact || false;
      const results = await search.search(args.query, {
        type: args.type,
        tags: args.tags
      });

      if (results.length === 0) {
        return [{ type: 'text', text: `No results for "${args.query}"` }];
      }

      let text = `Found ${results.length} result(s) for "${args.query}":\n\n`;
      for (const r of results) {
        if (compact) {
          text += `- **${r.id}** [${r.type}] ${r.title}\n`;
        } else {
          text += `### ${r.id}: ${r.title}\n`;
          text += `Type: ${r.type} | Status: ${r.status} | Tags: ${(Array.isArray(r.tags) ? r.tags : []).join(', ')}`;
          if (r.score) text += ` | Score: ${r.score.toFixed(1)}`;
          text += '\n';
          if (r.snippet) text += `> ${r.snippet}\n`;
          text += '\n';
        }
      }
      if (compact) text += '\n_Use brain_get_entry for details._';
      return [{ type: 'text', text }];
    }

    case 'brain_get_entry': {
      const entry = await manager.getEntry(args.id);
      if (!entry) {
        return [{ type: 'text', text: `Entry ${args.id} not found.` }];
      }

      let text = entry.content;

      // Add relationships section with resolved titles
      const index = await manager.loadIndex();
      const indexEntry = index.entries.find(e => e.id === args.id);
      if (indexEntry && indexEntry.related && indexEntry.related.length > 0) {
        text += '\n\n## Yhteydet\n';
        for (const rel of indexEntry.related) {
          const relatedEntry = index.entries.find(e => e.id === rel.id);
          const title = relatedEntry ? relatedEntry.title : '(tuntematon)';
          text += `- **${rel.id}** [${rel.rel}]: ${title}\n`;
        }
      }

      return [{ type: 'text', text }];
    }

    case 'brain_list': {
      const compact = args.compact || false;
      const entries = await manager.listEntries({
        type: args.type,
        status: args.status,
        tags: args.tags
      });

      if (entries.length === 0) {
        return [{ type: 'text', text: 'No entries found matching criteria.' }];
      }

      let text = `${entries.length} entries:\n\n`;
      for (const e of entries) {
        if (compact) {
          text += `- **${e.id}** ${e.title}\n`;
        } else {
          text += `- **${e.id}** [${e.type}/${e.status}] ${e.title} (${e.date}) [${(Array.isArray(e.tags) ? e.tags : []).join(', ')}]\n`;
        }
      }
      return [{ type: 'text', text }];
    }

    case 'brain_record_decision': {
      // Duplicate check
      const decDupes = await manager.checkDuplicate(args.title, 'decision');
      let decDupeWarn = '';
      if (decDupes.length > 0) {
        decDupeWarn = `\n⚠️ Similar entries: ${decDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
      }

      // Build related array from explicit relations + supersedes shorthand
      const relatedInput = args.related || [];
      if (args.supersedes) {
        relatedInput.push({ id: args.supersedes, rel: 'supersedes' });
      }

      const body = buildDecisionBody(args);
      const result = await manager.createEntry({
        type: 'decision',
        prefix: 'DEC',
        dirName: 'decisions',
        title: args.title,
        frontmatter: {
          status: 'active',
          tags: args.tags || [],
          related: relatedInput,
          files: args.files || [],
          superseded_by: null,
          ...(args.validation ? { validation: args.validation } : {})
        },
        body
      });

      // Set up bidirectional links for all relations
      for (const rel of relatedInput) {
        try {
          await manager.linkEntries(result.id, rel.id, rel.rel);
        } catch {
          // Target entry might not exist yet — skip silently
        }
      }

      // Extract rules for cognitive firewall
      try {
        await manager.addRulesForEntry(result._indexEntry, body);
      } catch { /* non-critical */ }

      trackSessionChange('decision', result.id, args.title);
      return [{ type: 'text', text: `Decision recorded: ${result.id} \u2192 ${result.path}${decDupeWarn}` }];
    }

    case 'brain_record_bug': {
      // Duplicate check
      const bugDupes = await manager.checkDuplicate(args.title, 'bug');
      let bugDupeWarn = '';
      if (bugDupes.length > 0) {
        bugDupeWarn = `\n⚠️ Similar entries: ${bugDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
      }

      const relatedInput = args.related || [];
      const body = buildBugBody(args);
      const result = await manager.createEntry({
        type: 'bug',
        prefix: 'BUG',
        dirName: 'bugs',
        title: args.title,
        frontmatter: {
          status: args.status || 'fixed',
          severity: args.severity || 'medium',
          tags: args.tags || [],
          related: relatedInput,
          files: args.files || [],
          root_cause: `"${manager.escapeYaml(args.root_cause)}"`,
          ...(args.validation ? { validation: args.validation } : {})
        },
        body
      });

      // Set up bidirectional links
      for (const rel of relatedInput) {
        try {
          await manager.linkEntries(result.id, rel.id, rel.rel);
        } catch {
          // skip
        }
      }

      // Extract rules for cognitive firewall
      try {
        await manager.addRulesForEntry(result._indexEntry, body);
      } catch { /* non-critical */ }

      trackSessionChange('bug', result.id, args.title);
      return [{ type: 'text', text: `Bug recorded: ${result.id} \u2192 ${result.path}${bugDupeWarn}` }];
    }

    case 'brain_record_implementation': {
      // Duplicate check
      const implDupes = await manager.checkDuplicate(args.title, 'implementation');
      let implDupeWarn = '';
      if (implDupes.length > 0) {
        implDupeWarn = `\n⚠️ Similar entries: ${implDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
      }

      const relatedInput = args.related || [];
      const body = buildImplementationBody(args);
      const result = await manager.createEntry({
        type: 'implementation',
        prefix: 'IMPL',
        dirName: 'implementations',
        title: args.title,
        frontmatter: {
          status: 'current',
          tags: args.tags || [],
          related: relatedInput,
          files: args.files || [],
          ...(args.validation ? { validation: args.validation } : {})
        },
        body
      });

      // Set up bidirectional links
      for (const rel of relatedInput) {
        try {
          await manager.linkEntries(result.id, rel.id, rel.rel);
        } catch {
          // skip
        }
      }

      // Extract rules for cognitive firewall
      try {
        await manager.addRulesForEntry(result._indexEntry, body);
      } catch { /* non-critical */ }

      trackSessionChange('implementation', result.id, args.title);
      return [{ type: 'text', text: `Implementation recorded: ${result.id} \u2192 ${result.path}${implDupeWarn}` }];
    }

    case 'brain_record_pattern': {
      // Duplicate check
      const patDupes = await manager.checkDuplicate(args.title, 'pattern');
      let patDupeWarn = '';
      if (patDupes.length > 0) {
        patDupeWarn = `\n⚠️ Similar entries: ${patDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
      }

      const relatedInput = args.related || [];
      const body = buildPatternBody(args);
      const result = await manager.createEntry({
        type: 'pattern',
        prefix: 'PAT',
        dirName: 'patterns',
        title: args.title,
        frontmatter: {
          tags: args.tags || [],
          related: relatedInput
        },
        body
      });

      // Set up bidirectional links
      for (const rel of relatedInput) {
        try {
          await manager.linkEntries(result.id, rel.id, rel.rel);
        } catch {
          // skip
        }
      }

      // Extract rules for cognitive firewall
      try {
        await manager.addRulesForEntry(result._indexEntry, body);
      } catch { /* non-critical */ }

      trackSessionChange('pattern', result.id, args.title);
      return [{ type: 'text', text: `Pattern recorded: ${result.id} \u2192 ${result.path}${patDupeWarn}` }];
    }

    case 'brain_record_lesson': {
      // Duplicate check
      const lesDupes = await manager.checkDuplicate(args.title, 'lesson');
      let lesDupeWarn = '';
      if (lesDupes.length > 0) {
        lesDupeWarn = `\n⚠️ Similar entries: ${lesDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
      }

      const relatedInput = args.related || [];
      const body = buildLessonBody(args);
      const result = await manager.createEntry({
        type: 'lesson',
        prefix: 'LES',
        dirName: 'lessons',
        title: args.title,
        frontmatter: {
          status: 'active',
          severity: args.severity || 'medium',
          trigger: args.trigger || 'correction',
          tags: args.tags || [],
          related: relatedInput,
          files: args.files || []
        },
        body
      });

      // Set up bidirectional links
      for (const rel of relatedInput) {
        try {
          await manager.linkEntries(result.id, rel.id, rel.rel);
        } catch {
          // skip
        }
      }

      // Store rule in index for fast brain_get_lessons lookup
      if (args.rule) {
        await manager.withLock(async () => {
          const idx = await manager.loadIndex();
          const entry = idx.entries.find(e => e.id === result.id);
          if (entry) {
            entry.rule = args.rule;
            await manager.saveIndex(idx);
          }
        });
      }

      // Extract rules for cognitive firewall (include rule field)
      try {
        const entryWithRule = { ...result._indexEntry, rule: args.rule };
        await manager.addRulesForEntry(entryWithRule, body);
      } catch { /* non-critical */ }

      trackSessionChange('lesson', result.id, args.title);
      return [{ type: 'text', text: `Lesson recorded: ${result.id} → ${result.path}${lesDupeWarn}` }];
    }

    case 'brain_get_lessons': {
      const compact = args.compact || false;
      const index = await manager.loadIndex();
      let lessons = index.entries.filter(e => e.type === 'lesson' && e.status === 'active');

      // Filter by severity
      if (args.severity) {
        lessons = lessons.filter(e => e.severity === args.severity);
      }

      // Filter by tags
      if (args.tags && args.tags.length > 0) {
        const tagSet = new Set(args.tags.map(t => t.toLowerCase()));
        lessons = lessons.filter(e =>
          Array.isArray(e.tags) && e.tags.some(t => tagSet.has(t.toLowerCase()))
        );
      }

      if (lessons.length === 0) {
        return [{ type: 'text', text: 'No active lessons found.' }];
      }

      // Sort by severity: high → medium → low
      const severityOrder = { high: 0, medium: 1, low: 2 };
      lessons.sort((a, b) => (severityOrder[a.severity || 'medium'] || 1) - (severityOrder[b.severity || 'medium'] || 1));

      let text = `## Lessons Learned (${lessons.length})\n\n`;

      if (compact) {
        // Compact: just rules
        for (const lesson of lessons) {
          const entry = await manager.getEntry(lesson.id);
          let rule = '';
          if (entry && entry.content) {
            const ruleMatch = entry.content.match(/## (?:Sääntö|Rule)\n([\s\S]*?)(?=\n## |$)/);
            if (ruleMatch) rule = ruleMatch[1].trim();
          }
          const icon = { high: '🔴', medium: '🟡', low: '🟢' }[lesson.severity || 'medium'] || '🟡';
          text += `- ${icon} **${lesson.id}**: ${rule || lesson.title}\n`;
        }
      } else {
        for (const lesson of lessons) {
          const icon = { high: '🔴', medium: '🟡', low: '🟢' }[lesson.severity || 'medium'] || '🟡';
          text += `### ${icon} ${lesson.id}: ${lesson.title}\n`;
          text += `Severity: ${(lesson.severity || 'medium').toUpperCase()} | Trigger: ${lesson.trigger || 'correction'} | Tags: ${(Array.isArray(lesson.tags) ? lesson.tags : []).join(', ')}\n`;

          // Read the rule from the file
          const entry = await manager.getEntry(lesson.id);
          if (entry && entry.content) {
            const ruleMatch = entry.content.match(/## (?:Sääntö|Rule)\n([\s\S]*?)(?=\n## |$)/);
            if (ruleMatch) text += `**Rule:** ${ruleMatch[1].trim()}\n`;
          }
          text += '\n';
        }
      }

      return [{ type: 'text', text }];
    }

    case 'brain_check_conflicts': {
      const { conflicts, warnings } = await checker.check(
        args.proposed_change,
        args.affected_files || []
      );

      if (conflicts.length === 0 && warnings.length === 0) {
        return [{ type: 'text', text: 'No conflicts found. Safe to proceed.' }];
      }

      let text = '';
      if (conflicts.length > 0) {
        text += `\u26a0 ${conflicts.length} CONFLICT(S):\n`;
        for (const c of conflicts) {
          text += `- **${c.entry_id}**: ${c.title}\n  Reason: ${c.reason}\n`;
        }
        text += '\n';
      }
      if (warnings.length > 0) {
        text += `\u2139 ${warnings.length} WARNING(S):\n`;
        for (const w of warnings) {
          text += `- **${w.entry_id}**: ${w.title}\n  Reason: ${w.reason}\n`;
        }
      }
      return [{ type: 'text', text }];
    }

    case 'brain_update_entry': {
      const updates = {};
      if (args.status) updates.status = args.status;
      if (args.title) updates.title = args.title;
      if (args.content) updates.content = args.content;
      if (args.add_related) updates.add_related = args.add_related;

      const updated = await manager.updateEntry(args.id, updates);
      if (!updated) {
        return [{ type: 'text', text: `Entry ${args.id} not found.` }];
      }

      // Set up bidirectional links for new relations
      if (args.add_related) {
        for (const rel of args.add_related) {
          try {
            await manager.linkEntries(args.id, rel.id, rel.rel);
          } catch {
            // skip
          }
        }
      }

      return [{ type: 'text', text: `Updated ${args.id}: ${Object.keys(updates).join(', ')}` }];
    }

    case 'brain_get_history': {
      const history = await manager.getHistory({
        since: args.since,
        limit: args.limit
      });
      return [{ type: 'text', text: history }];
    }

    case 'brain_link_entries': {
      const result = await manager.linkEntries(args.from, args.to, args.rel);
      return [{ type: 'text', text: `Linked: ${result.from} \u2014[${result.rel}]\u2192 ${result.to} (inverse: ${result.inverseRel})` }];
    }

    case 'brain_get_context_for_files': {
      const compact = args.compact || false;
      const grouped = await manager.getContextForFiles(args.files);

      let text = `Context for files: ${args.files.join(', ')}\n\n`;
      let hasContent = false;

      if (grouped.decisions.length > 0) {
        hasContent = true;
        text += '## Aktiiviset p\u00e4\u00e4t\u00f6kset\n';
        for (const d of grouped.decisions) {
          text += `- **${d.id}**${compact ? '' : ` [${d.status}]`}: ${d.title}\n`;
        }
        text += '\n';
      }
      if (grouped.bugs.length > 0) {
        hasContent = true;
        text += '## Bugit\n';
        for (const b of grouped.bugs) {
          text += `- **${b.id}**${compact ? '' : ` [${b.status}]`}: ${b.title}\n`;
        }
        text += '\n';
      }
      if (grouped.implementations.length > 0) {
        hasContent = true;
        text += '## Toteutukset\n';
        for (const i of grouped.implementations) {
          text += `- **${i.id}**${compact ? '' : ` [${i.status}]`}: ${i.title}\n`;
        }
        text += '\n';
      }
      if (grouped.patterns.length > 0) {
        hasContent = true;
        text += '## Mallit\n';
        for (const p of grouped.patterns) {
          text += `- **${p.id}**: ${p.title}\n`;
        }
        text += '\n';
      }
      if (grouped.lessons && grouped.lessons.length > 0) {
        hasContent = true;
        text += '## Opit\n';
        for (const l of grouped.lessons) {
          text += `- **${l.id}**: ${l.title}\n`;
        }
        text += '\n';
      }

      if (!hasContent) {
        text += 'No brain context found for these files.';
      }
      if (compact && hasContent) {
        text += '_Use brain_get_entry for full details._';
      }

      return [{ type: 'text', text }];
    }

    case 'brain_health': {
      const stats = await manager.getHealthData(args.threshold_days || 30);
      return [{ type: 'text', text: formatHealthReport(stats) }];
    }

    case 'brain_review_entry': {
      const result = await manager.reviewEntry(args.id, args.notes);
      if (!result) {
        return [{ type: 'text', text: `Entry ${args.id} not found.` }];
      }
      return [{ type: 'text', text: `Reviewed ${result.id} — last_reviewed updated to ${result.last_reviewed}` }];
    }

    case 'brain_record_plan': {
      const relatedInput = args.related || [];
      const body = buildPlanBody(args);
      const result = await manager.createEntry({
        type: 'plan',
        prefix: 'PLAN',
        dirName: 'plans',
        title: args.title,
        frontmatter: {
          status: args.status || 'partial',
          priority: args.priority || 'medium',
          tags: args.tags || [],
          related: relatedInput,
          files: args.files || []
        },
        body
      });

      for (const rel of relatedInput) {
        try {
          await manager.linkEntries(result.id, rel.id, rel.rel);
        } catch {
          // skip
        }
      }

      trackSessionChange('plan', result.id, args.title);
      return [{ type: 'text', text: `Plan recorded: ${result.id} \u2192 ${result.path}` }];
    }

    case 'brain_get_backlog': {
      const compact = args.compact || false;
      const index = await manager.loadIndex();
      const plans = index.entries.filter(e => e.type === 'plan');

      let filtered = plans;
      if (!args.include_completed) {
        filtered = plans.filter(e => e.status !== 'completed' && e.status !== 'abandoned');
      }

      if (filtered.length === 0) {
        return [{ type: 'text', text: 'No plans in backlog.' }];
      }

      // Sort by priority
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      filtered.sort((a, b) => (priorityOrder[a.priority || 'medium'] || 2) - (priorityOrder[b.priority || 'medium'] || 2));

      let text = `## Backlog (${filtered.length} plan${filtered.length > 1 ? 's' : ''})\n\n`;
      const now = Date.now();

      for (const plan of filtered) {
        const daysAgo = Math.round((now - new Date(plan.date).getTime()) / 86400000);
        const icon = { critical: '\ud83d\udd34', high: '\ud83d\udd34', medium: '\ud83d\udfe1', low: '\ud83d\udfe2' }[plan.priority || 'medium'] || '\ud83d\udfe1';
        const prio = (plan.priority || 'medium').toUpperCase();

        if (compact) {
          text += `- ${icon} **${plan.id}** [${prio}] ${plan.title} (${daysAgo}d)\n`;
        } else {
          text += `### ${icon} ${prio}: ${plan.id} \u2014 ${plan.title} (${daysAgo} pv sitten)\n`;
          text += `Status: ${plan.status}\n`;

          // Read file to show deferred items
          const entry = await manager.getEntry(plan.id);
          if (entry && entry.content) {
            const deferredMatch = entry.content.match(/## Lyk\u00e4tty my\u00f6hemm\u00e4ksi\n([\s\S]*?)(?=\n## |$)/);
            if (deferredMatch && deferredMatch[1].trim()) {
              text += `Lyk\u00e4tty:\n${deferredMatch[1].trim()}\n`;
            }
            const nextMatch = entry.content.match(/## Seuraavat askeleet\n([\s\S]*?)$/);
            if (nextMatch && nextMatch[1].trim()) {
              text += `Seuraava: ${nextMatch[1].trim()}\n`;
            }
          }
          text += '\n';
        }
      }

      return [{ type: 'text', text }];
    }

    case 'brain_update_plan': {
      const entry = await manager.getEntry(args.id);
      if (!entry) {
        return [{ type: 'text', text: `Plan ${args.id} not found.` }];
      }

      let content = entry.content;
      const changes = [];

      // Move deferred items to implemented
      if (args.completed_items && args.completed_items.length > 0) {
        for (const completed of args.completed_items) {
          // Match deferred item line and mark as done
          const escapedItem = completed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const deferredRegex = new RegExp(`- \\[ \\] (.*${escapedItem}.*)`, 'i');
          const match = content.match(deferredRegex);
          if (match) {
            content = content.replace(match[0], `- [x] ${match[1]} \u2714`);
            // Also add to implemented section
            const implSection = content.match(/## Toteutettu\n([\s\S]*?)(?=\n## )/);
            if (implSection) {
              const insertPoint = content.indexOf(implSection[0]) + implSection[0].length;
              content = content.substring(0, insertPoint) + `\n- [x] ${match[1]}\n` + content.substring(insertPoint);
            }
            changes.push(`completed: ${completed}`);
          }
        }
      }

      // Add new deferred items
      if (args.new_deferred && args.new_deferred.length > 0) {
        const deferredSection = content.indexOf('## Lyk\u00e4tty my\u00f6hemm\u00e4ksi');
        if (deferredSection !== -1) {
          const nextSection = content.indexOf('\n## ', deferredSection + 1);
          const insertPoint = nextSection !== -1 ? nextSection : content.length;
          let newItems = '';
          for (const d of args.new_deferred) {
            newItems += `- [ ] ${d.item} (syy: ${d.reason})\n`;
          }
          content = content.substring(0, insertPoint) + newItems + content.substring(insertPoint);
          changes.push(`deferred ${args.new_deferred.length} new items`);
        }
      }

      // Add new implemented items
      if (args.new_implemented && args.new_implemented.length > 0) {
        const implSection = content.indexOf('## Toteutettu');
        if (implSection !== -1) {
          const nextSection = content.indexOf('\n## ', implSection + 1);
          const insertPoint = nextSection !== -1 ? nextSection : content.length;
          let newItems = '';
          for (const item of args.new_implemented) {
            newItems += `- [x] ${item}\n`;
          }
          content = content.substring(0, insertPoint) + newItems + content.substring(insertPoint);
          changes.push(`implemented ${args.new_implemented.length} items`);
        }
      }

      // Update next_steps
      if (args.next_steps) {
        const nextSection = content.match(/## Seuraavat askeleet\n[\s\S]*$/);
        if (nextSection) {
          content = content.replace(nextSection[0], `## Seuraavat askeleet\n\n${args.next_steps}\n`);
          changes.push('updated next_steps');
        }
      }

      // Build updates for manager
      const updates = { content: content.replace(/^---[\s\S]*?---\n*/, '') };
      if (args.status) updates.status = args.status;

      await manager.updateEntry(args.id, updates);

      return [{ type: 'text', text: `Updated ${args.id}: ${changes.join(', ') || 'status updated'}` }];
    }

    case 'brain_mine_sessions': {
      const daysBack = args.days_back || 30;
      const results = await mineProjectContext(
        manager.projectPath,
        args.file_paths,
        { daysBack, keywords: args.keywords || [] }
      );

      if (!results.found) {
        return [{ type: 'text', text: `No conversation logs found for this project.\n${results.reason || ''}` }];
      }

      if (results.sessions.length === 0) {
        return [{ type: 'text', text: `No sessions found mentioning these files in the last ${daysBack} days.\nSearched in: ${(results.searchedDirs || []).join(', ')}` }];
      }

      let output = `## Session Context Mining\n\n`;
      output += `**Searched files:** ${args.file_paths.join(', ')}\n`;
      if (args.keywords?.length > 0) output += `**Keywords:** ${args.keywords.join(', ')}\n`;
      output += `**Period:** last ${daysBack} days\n`;
      output += `**Sessions with matches:** ${results.sessions.length}\n\n`;

      for (const session of results.sessions) {
        output += `---\n### ${session.summary}\n`;
        output += `*${session.period.start} — ${session.period.end}*\n\n`;

        if (session.touchedFiles.length > 0) {
          output += `**Files modified in session:** ${session.touchedFiles.join(', ')}\n\n`;
        }

        for (const msg of session.relevantMessages) {
          const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
          const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
          output += `**${roleLabel}** (${timeStr}, relevance: ${msg.score}):\n`;
          output += `> ${msg.text.replace(/\n/g, '\n> ')}\n\n`;
        }
      }

      return [{ type: 'text', text: output }];
    }

    case 'brain_get_session_summary': {
      if (sessionChanges.length === 0) {
        return [{ type: 'text', text: 'No brain changes in this session.' }];
      }

      let text = `## Session Summary (${sessionChanges.length} changes)\n\n`;
      const byType = {};
      for (const c of sessionChanges) {
        if (!byType[c.type]) byType[c.type] = [];
        byType[c.type].push(c);
      }

      for (const [type, changes] of Object.entries(byType)) {
        text += `### ${type} (${changes.length})\n`;
        for (const c of changes) {
          text += `- **${c.id}**: ${c.title} (${c.timestamp})\n`;
        }
        text += '\n';
      }

      text += '\n_Include this summary in compact context to preserve session work._';
      return [{ type: 'text', text }];
    }

    case 'brain_coordinate_team': {
      const availableAgents = ['curator', 'documenter', 'reviewer', 'backlog'];
      const requestedAgents = args.agents || availableAgents;

      let text = `## Brain Team Coordination\n\n`;
      text += `Requested agents: ${requestedAgents.join(', ')}\n\n`;
      text += `To run a comprehensive brain maintenance, use these commands in order:\n\n`;

      for (const agent of requestedAgents) {
        switch (agent) {
          case 'curator':
            text += `### 1. Curator\n`;
            text += `Run: \`/agent brain-curator\`\n`;
            text += `Purpose: Clean stale entries, fix relationships, merge duplicates\n\n`;
            break;
          case 'documenter':
            text += `### 2. Documenter\n`;
            text += `Run: \`/agent brain-documenter\`\n`;
            text += `Purpose: Document undocumented code changes and architectural decisions\n\n`;
            break;
          case 'reviewer':
            text += `### 3. Reviewer\n`;
            text += `Run: \`/agent brain-reviewer\`\n`;
            text += `Purpose: Review entries for accuracy, mark stale ones, suggest updates\n\n`;
            break;
          case 'backlog':
            text += `### 4. Backlog\n`;
            text += `Run: \`/agent brain-backlog\`\n`;
            text += `Purpose: Review and prioritize incomplete plans, check for abandoned work\n\n`;
            break;
        }
      }

      // Include current health status as reference
      try {
        const health = await manager.getHealthData(30);
        text += `### Current Health Status\n`;
        text += `- Total entries: ${health.total}\n`;
        if (health.stale.length > 0) text += `- Stale: ${health.stale.length}\n`;
        if (health.orphaned.length > 0) text += `- Orphaned: ${health.orphaned.length}\n`;
        if (health.brokenLinks.length > 0) text += `- Broken links: ${health.brokenLinks.length}\n`;
        if (health.incompletePlans.length > 0) text += `- Incomplete plans: ${health.incompletePlans.length}\n`;
      } catch {
        // Health check failed, skip
      }

      return [{ type: 'text', text }];
    }

    case 'brain_rebuild_index': {
      const result = await manager.rebuildIndex();
      let text = `## Index Rebuilt\n\n`;
      text += `**Entries recovered:** ${result.entriesFound}\n\n`;
      text += `**Counters:**\n`;
      for (const [prefix, count] of Object.entries(result.counters)) {
        text += `- ${prefix}: ${count}\n`;
      }
      return [{ type: 'text', text }];
    }

    case 'brain_get_metrics': {
      const report = await metrics.getReport();
      return [{ type: 'text', text: report }];
    }

    case 'brain_create_snapshot': {
      const result = await manager.createSnapshot(args.label);
      let text = `## Snapshot Created\n\n`;
      text += `**Timestamp:** ${result.timestamp}\n`;
      text += `**Entries:** ${result.entriesCount}\n`;
      text += `**Path:** ${result.path}\n\n`;
      text += `_Use brain_list_snapshots to see all snapshots, brain_restore_snapshot to restore._`;
      return [{ type: 'text', text }];
    }

    case 'brain_list_snapshots': {
      const snapshots = await manager.listSnapshots();
      if (snapshots.length === 0) {
        return [{ type: 'text', text: 'No snapshots found. Use `brain_create_snapshot` to create one.' }];
      }
      let text = `## Available Snapshots\n\n`;
      for (const s of snapshots) {
        text += `- **${s.name}** — ${s.timestamp} (${s.entriesCount} entries)`;
        if (s.label) text += ` [${s.label}]`;
        text += `\n`;
      }
      text += `\n_Use brain_restore_snapshot with the name to restore._`;
      return [{ type: 'text', text }];
    }

    case 'brain_restore_snapshot': {
      try {
        const result = await manager.restoreSnapshot(args.name);
        let text = `## Snapshot Restored\n\n`;
        text += `**From:** ${args.name}\n`;
        text += `**Entries restored:** ${result.entriesCount}\n\n`;
        text += `⚠️ A backup was created before restoring. Use brain_list_snapshots to see it.`;
        return [{ type: 'text', text }];
      } catch (err) {
        return [{ type: 'text', text: `Error restoring snapshot: ${err.message}` }];
      }
    }

    case 'brain_update': {
      const { execSync } = await import('node:child_process');
      const { dirname, join: pathJoin } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __fn = fileURLToPath(import.meta.url);
      const __dn = dirname(__fn);
      const installScript = pathJoin(__dn, 'install.js');
      const projectPath = process.env.BRAIN_PROJECT_PATH;

      try {
        const output = execSync(`node "${installScript}" "${projectPath}" --update`, {
          encoding: 'utf-8',
          timeout: 30000
        });
        return [{ type: 'text', text: `## Brain Updated\n\n${output}` }];
      } catch (err) {
        return [{ type: 'text', text: `Error updating brain: ${err.message}\n${err.stdout || ''}` }];
      }
    }

    case 'brain_traverse_graph': {
      const graph = new BrainGraph(manager);
      const mode = args.mode;

      if (mode === 'traverse') {
        if (!args.start_id) return [{ type: 'text', text: 'start_id is required for traverse mode' }];
        const result = await graph.traverse(args.start_id, {
          maxDepth: args.max_depth || 3,
          relTypes: args.rel_types
        });
        let text = `## Graph traversal from ${args.start_id} (depth ${args.max_depth || 3})\n\n`;
        text += `**Nodes (${result.nodes.length}):**\n`;
        for (const node of result.nodes) {
          const indent = '  '.repeat(node.depth);
          text += `${indent}- **${node.id}** [${node.type}/${node.status}] ${node.title}\n`;
        }
        text += `\n**Edges (${result.edges.length}):**\n`;
        for (const edge of result.edges) {
          text += `- ${edge.from} \u2014[${edge.rel}]\u2192 ${edge.to}\n`;
        }
        return [{ type: 'text', text }];
      }

      if (mode === 'path') {
        if (!args.start_id || !args.target_id) return [{ type: 'text', text: 'start_id and target_id are required for path mode' }];
        const path = await graph.findPath(args.start_id, args.target_id);
        if (path.length === 0) {
          return [{ type: 'text', text: `No path found between ${args.start_id} and ${args.target_id}` }];
        }
        let text = `## Path: ${args.start_id} \u2192 ${args.target_id}\n\n`;
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          text += `${i + 1}. **${p.id}** ${p.title}`;
          if (p.rel) text += ` \u2014[${p.rel}]\u2192`;
          text += '\n';
        }
        return [{ type: 'text', text }];
      }

      if (mode === 'impact') {
        if (!args.start_id) return [{ type: 'text', text: 'start_id is required for impact mode' }];
        const dependents = await graph.dependents(args.start_id, args.max_depth || 3);
        let text = `## Impact analysis for ${args.start_id}\n\n`;
        if (dependents.length === 0) {
          text += 'No dependent entries found.\n';
        } else {
          text += `**${dependents.length} dependent entries:**\n`;
          for (const dep of dependents) {
            text += `- **${dep.id}** [${dep.type}/${dep.status}] ${dep.title} (via ${dep.rel}, depth ${dep.depth})\n`;
          }
        }
        return [{ type: 'text', text }];
      }

      if (mode === 'cycles') {
        const cycles = await graph.findCycles();
        let text = '## Cycle detection\n\n';
        if (cycles.length === 0) {
          text += 'No cycles found. Graph is acyclic.\n';
        } else {
          text += `**${cycles.length} cycles found:**\n`;
          for (const cycle of cycles) {
            text += `- ${cycle.join(' \u2192 ')}\n`;
          }
        }
        return [{ type: 'text', text }];
      }

      return [{ type: 'text', text: `Unknown mode: ${mode}` }];
    }

    case 'brain_auto_document': {
      const documenter = new AutoDocumenter(manager);
      const since = args.since || '7 days ago';
      const dryRun = args.dry_run !== false;

      const result = await documenter.analyze(since, dryRun);

      let text = `## Auto-documentation ${dryRun ? '(dry run)' : ''}\n\n`;
      text += `Analyzed commits since: ${since}\n`;
      text += `Already documented: ${result.existing} commits\n\n`;

      if (result.suggestions.length === 0) {
        text += 'No undocumented changes found.\n';
      } else {
        text += `**${result.suggestions.length} suggestions:**\n\n`;
        for (const s of result.suggestions) {
          text += `### ${s.type.toUpperCase()}: ${s.title}\n`;
          text += `- Files: ${s.files.join(', ')}\n`;
          text += `- Commit: \`${s.sha?.substring(0, 8)}\` ${s.commitMessage}\n\n`;
        }
        if (dryRun) {
          text += '_Set dry_run=false to create these entries._\n';
        }
      }

      return [{ type: 'text', text }];
    }

    case 'brain_preflight': {
      // Ensure rule index is loaded
      await manager.loadRuleIndex();

      const grouped = await manager.getContextForFiles(args.files);
      const rules = manager.ruleIndex.getRulesForFiles(args.files);

      // Separate bug categories
      const openBugs = grouped.bugs.filter(b => b.status === 'open');
      const fixedBugs = grouped.bugs.filter(b => b.status === 'fixed');
      const activeDecisions = grouped.decisions.filter(d => d.status === 'active');
      const lessons = grouped.lessons || [];

      // Check conflicts if intent provided
      let conflicts = [];
      let warnings = [];
      if (args.intent) {
        const conflictResult = await checker.check(args.intent, args.files);
        conflicts = conflictResult.conflicts || [];
        warnings = conflictResult.warnings || [];
      }

      // Calculate risk score
      const risk = calculateRiskScore({
        activeDecisions,
        openBugs,
        fixedBugs,
        rules,
        conflicts,
        warnings,
        lessons
      });
      const label = riskLabel(risk);

      // Build output
      let text = `# PREFLIGHT: ${args.files.join(', ')}\n\n`;
      text += `## RISK: ${risk}/100 (${label})\n\n`;

      // Rules section
      if (rules.length > 0) {
        text += `## SÄÄNNÖT\n`;
        for (const rule of rules) {
          const icon = { DO: '✅', DONT: '🚫', GUARD: '🛡️' }[rule.type] || '📋';
          text += `${icon} ${rule.type}: ${rule.text} (${rule.source_id}${rule.severity ? ', ' + rule.severity : ''})\n`;
        }
        text += '\n';
      }

      // Active decisions
      if (activeDecisions.length > 0) {
        text += `## AKTIIVISET PÄÄTÖKSET\n`;
        for (const d of activeDecisions) {
          text += `- ${d.id} [${d.status}]: ${d.title}\n`;
        }
        text += '\n';
      }

      // Regression risks (fixed bugs)
      if (fixedBugs.length > 0) {
        text += `## REGRESSIORISKIT\n`;
        for (const b of fixedBugs) {
          text += `- ${b.id} [${b.status}, ${b.severity || 'medium'}]: ${b.title}\n`;
        }
        text += '\n';
      }

      // Open bugs
      if (openBugs.length > 0) {
        text += `## AVOIMET BUGIT\n`;
        for (const b of openBugs) {
          text += `- ${b.id} [${b.severity || 'medium'}]: ${b.title}\n`;
        }
        text += '\n';
      }

      // Patterns
      if (grouped.patterns.length > 0) {
        text += `## MALLIT\n`;
        for (const p of grouped.patterns) {
          text += `- ${p.id}: ${p.title}\n`;
        }
        text += '\n';
      }

      // Lessons
      if (lessons.length > 0) {
        text += `## OPIT\n`;
        for (const l of lessons) {
          text += `- ${l.id} [${l.severity || 'medium'}]: ${l.title}`;
          if (l.rule) text += ` — ${l.rule}`;
          text += '\n';
        }
        text += '\n';
      }

      // Intent conflicts
      if (conflicts.length > 0) {
        text += `## INTENT-KONFLIKTIT\n`;
        for (const c of conflicts) {
          text += `- ⚠ ${c.entry_id}: ${c.title} — ${c.reason}\n`;
        }
        text += '\n';
      }
      if (warnings.length > 0) {
        text += `## VAROITUKSET\n`;
        for (const w of warnings) {
          text += `- ℹ ${w.entry_id}: ${w.title} — ${w.reason}\n`;
        }
        text += '\n';
      }

      if (rules.length === 0 && activeDecisions.length === 0 && fixedBugs.length === 0 && openBugs.length === 0) {
        text += 'Ei sääntöjä tai kontekstia näille tiedostoille.\n';
      }

      return [{ type: 'text', text }];
    }

    case 'brain_validate_change': {
      // Ensure rule index is loaded
      await manager.loadRuleIndex();

      const rules = manager.ruleIndex.getRulesForFiles(args.files);
      const validator = new ChangeValidator();
      const result = validator.validate(rules, args.change_description, args.changes_summary);

      const status = result.passed ? 'PASS' : 'FAIL';
      let text = `# VALIDOINTI: ${status}`;
      if (!result.passed) {
        text += ` (${result.violations.length} rikkomus${result.violations.length > 1 ? 'ta' : ''})`;
      }
      if (result.warnings.length > 0) {
        text += ` (${result.warnings.length} varoitus${result.warnings.length > 1 ? 'ta' : ''})`;
      }
      text += '\n\n';

      if (result.violations.length > 0) {
        text += `## RIKKOMUKSET\n`;
        for (let i = 0; i < result.violations.length; i++) {
          const v = result.violations[i];
          text += `${i + 1}. ${v.type}: "${args.change_description}" voi rikkoa sääntöä\n`;
          text += `   Sääntö: ${v.rule.type} — "${v.rule.text}" (${v.rule.source_id})\n`;
        }
        text += '\n';
      }

      if (result.warnings.length > 0) {
        text += `## VAROITUKSET\n`;
        for (let i = 0; i < result.warnings.length; i++) {
          const w = result.warnings[i];
          text += `${i + 1}. ${w.reason}\n`;
        }
        text += '\n';
      }

      if (result.recommendations.length > 0) {
        text += `## SUOSITUKSET\n`;
        for (const rec of result.recommendations) {
          text += `- ${rec}\n`;
        }
        text += '\n';
      }

      if (result.passed && result.warnings.length === 0) {
        text += 'Ei rikkomuksia. Muutokset ovat sääntöjen mukaisia.\n';
      }

      return [{ type: 'text', text }];
    }

    case 'brain_rebuild_rules': {
      const stats = await manager.rebuildRuleIndex();
      let text = `Rule index rebuilt: ${stats.totalRules} rules extracted\n`;
      text += `- ${stats.doCount} DO rules, ${stats.dontCount} DONT rules, ${stats.guardCount} GUARD rules\n`;
      text += `- Files covered: ${stats.filesCovered}\n`;
      return [{ type: 'text', text }];
    }

    default:
      return [{ type: 'text', text: `Unknown tool: ${name}` }];
  }
}

// ── Body builders ──

function buildDecisionBody(args) {
  let body = `## ${t('context')}\n${args.context}\n\n`;
  body += `## ${t('decision')}\n${args.decision}\n\n`;

  if (args.alternatives && args.alternatives.length > 0) {
    body += `## ${t('alternatives')}\n`;
    for (let i = 0; i < args.alternatives.length; i++) {
      body += `${i + 1}. ${args.alternatives[i]}\n`;
    }
    body += '\n';
  }

  if (args.consequences && args.consequences.length > 0) {
    body += `## ${t('consequences')}\n`;
    for (const c of args.consequences) {
      body += `- ${c}\n`;
    }
    body += '\n';
  }

  if (args.files && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  if (args.validation) {
    body += `## ${t('validation')}\n\`\`\`\n${args.validation}\n\`\`\`\n`;
  }

  return body;
}

function buildBugBody(args) {
  let body = `## ${t('symptoms')}\n${args.symptoms}\n\n`;
  body += `## ${t('root_cause')}\n${args.root_cause}\n\n`;
  body += `## ${t('fix')}\n${args.fix}\n\n`;

  if (args.files && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  if (args.validation) {
    body += `## ${t('regression_test')}\n\`\`\`\n${args.validation}\n\`\`\`\n`;
  }

  return body;
}

function buildImplementationBody(args) {
  let body = `## ${t('description')}\n${args.description}\n\n`;

  if (args.key_details) {
    body += `## ${t('key_details')}\n${args.key_details}\n\n`;
  }

  if (args.why) {
    body += `## ${t('why')}\n${args.why}\n\n`;
  }

  if (args.files && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  if (args.validation) {
    body += `## ${t('validation')}\n\`\`\`\n${args.validation}\n\`\`\`\n`;
  }

  return body;
}

function buildPatternBody(args) {
  let body = `## ${t('pattern')}\n${args.pattern}\n\n`;

  if (args.example) {
    body += `## ${t('example')}\n\`\`\`\n${args.example}\n\`\`\`\n`;
  }

  return body;
}

function buildLessonBody(args) {
  let body = `## ${t('what_happened')}\n${args.what_happened}\n\n`;
  body += `## ${t('lesson')}\n${args.lesson}\n\n`;
  body += `## ${t('rule')}\n${args.rule}\n\n`;

  if (args.trigger) {
    body += `## ${t('trigger_label')}\n${args.trigger}\n\n`;
  }

  if (args.files && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  return body;
}

function buildPlanBody(args) {
  let body = `## ${t('original_plan')}\n\n${args.scope}\n\n`;

  body += `## ${t('implemented')}\n\n`;
  if (args.implemented && args.implemented.length > 0) {
    for (const item of args.implemented) {
      body += `- [x] ${item}\n`;
    }
  } else {
    body += `${t('not_implemented')}\n`;
  }
  body += '\n';

  body += `## ${t('deferred')}\n\n`;
  if (args.deferred && args.deferred.length > 0) {
    for (const d of args.deferred) {
      body += `- [ ] ${d.item} (syy: ${d.reason})\n`;
    }
  } else {
    body += `${t('not_deferred')}\n`;
  }
  body += '\n';

  body += `## ${t('next_steps')}\n\n`;
  body += (args.next_steps || t('not_defined')) + '\n';

  return body;
}

function formatHealthReport(stats) {
  let text = `## Brain Health Report\n\n`;
  text += `**Total entries:** ${stats.total}\n\n`;

  // By type
  text += `### Entries by type\n`;
  for (const [type, count] of Object.entries(stats.byType)) {
    text += `- ${type}: ${count}\n`;
  }
  text += '\n';

  // By status
  text += `### Entries by status\n`;
  for (const [status, count] of Object.entries(stats.byStatus)) {
    text += `- ${status}: ${count}\n`;
  }
  text += '\n';

  // Issues
  let issueCount = 0;

  if (stats.stale.length > 0) {
    issueCount += stats.stale.length;
    text += `### \u26a0 Stale entries (${stats.stale.length})\n`;
    for (const s of stats.stale) {
      text += `- **${s.id}**: ${s.title} (${s.daysSince} days since review)\n`;
    }
    text += '\n';
  }

  if (stats.orphaned.length > 0) {
    issueCount += stats.orphaned.length;
    text += `### \u26a0 Orphaned entries (${stats.orphaned.length})\n`;
    text += 'These entries have no relationships (neither incoming nor outgoing):\n';
    for (const o of stats.orphaned) {
      text += `- **${o.id}** [${o.type}]: ${o.title}\n`;
    }
    text += '\n';
  }

  if (stats.brokenLinks.length > 0) {
    issueCount += stats.brokenLinks.length;
    text += `### \u274c Broken links (${stats.brokenLinks.length})\n`;
    for (const b of stats.brokenLinks) {
      text += `- ${b.from} \u2192 ${b.to} [${b.rel}] (target not found)\n`;
    }
    text += '\n';
  }

  if (stats.missingBidirectional.length > 0) {
    issueCount += stats.missingBidirectional.length;
    text += `### \u26a0 Missing bidirectional links (${stats.missingBidirectional.length})\n`;
    for (const m of stats.missingBidirectional) {
      text += `- ${m.from} \u2192 ${m.to} [${m.rel}] (no inverse)\n`;
    }
    text += '\n';
  }

  if (stats.activeDecisionsWithoutImpl.length > 0) {
    issueCount += stats.activeDecisionsWithoutImpl.length;
    text += `### \u2139 Active decisions without implementation (${stats.activeDecisionsWithoutImpl.length})\n`;
    for (const d of stats.activeDecisionsWithoutImpl) {
      text += `- **${d.id}**: ${d.title}\n`;
    }
    text += '\n';
  }

  if (stats.oldOpenBugs.length > 0) {
    issueCount += stats.oldOpenBugs.length;
    text += `### \u26a0 Old open bugs (${stats.oldOpenBugs.length})\n`;
    for (const b of stats.oldOpenBugs) {
      text += `- **${b.id}**: ${b.title} (${b.ageDays} days old)\n`;
    }
    text += '\n';
  }

  if (stats.incompletePlans.length > 0) {
    text += `### \ud83d\udccb Incomplete plans (${stats.incompletePlans.length})\n`;
    for (const p of stats.incompletePlans) {
      text += `- **${p.id}** [${p.priority}/${p.status}]: ${p.title}\n`;
    }
    text += '\n';
  }

  if (issueCount === 0) {
    text += '\u2705 No issues found. Brain is healthy!\n';
  }

  return text;
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

  // Initialize language from manifest
  try {
    const manifest = await manager.loadManifest();
    if (manifest.language) {
      t = getTranslator(manifest.language);
    }
  } catch { /* use default fi */ }

  // Load rule index from index.json at startup
  try {
    await manager.loadRuleIndex();
    process.stderr.write(`[brain] Rule index loaded\n`);
  } catch { /* non-critical, will rebuild on first use */ }

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
          const content = await handleTool(manager, search, checker, metrics, toolName, toolArgs);
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
