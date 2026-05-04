import { z } from 'zod';

/**
 * Zod validation schemas for all Brain MCP tool inputs.
 * Prevents data corruption in index.json and YAML frontmatter.
 */

// ── Shared primitives ──

const entryIdPattern = /^(DEC|BUG|IMPL|PAT|PLAN|LES|RES)-\d{3,}$/;

export const EntryId = z.string().regex(entryIdPattern, 'Invalid entry ID format (e.g. DEC-001, BUG-003)');

export const Title = z.string().min(3, 'Title must be at least 3 characters').max(200, 'Title must be at most 200 characters');

export const RelationType = z.enum([
  'supersedes', 'superseded_by', 'caused_by', 'implements', 'fixes', 'used_in', 'relates_to'
]);

export const RelatedEntry = z.object({
  id: EntryId,
  rel: RelationType
});

export const Tags = z.array(z.string().min(1).max(50)).optional().default([]);

export const Files = z.array(z.string().min(1).max(500)).optional().default([]);

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO format YYYY-MM-DD').optional();

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);

export const LessonSeverity = z.enum(['low', 'medium', 'high']);

export const Trigger = z.enum(['correction', 'discovery', 'bug', 'review']);

// ── Tool input schemas ──

export const RecordDecisionSchema = z.object({
  title: Title,
  context: z.string().min(1, 'Context is required'),
  decision: z.string().min(1, 'Decision is required'),
  alternatives: z.array(z.string()).optional(),
  consequences: z.array(z.string()).optional(),
  tags: Tags,
  files: Files,
  related: z.array(RelatedEntry).optional().default([]),
  supersedes: EntryId.optional(),
  validation: z.string().optional()
});

export const RecordBugSchema = z.object({
  title: Title,
  symptoms: z.string().min(1, 'Symptoms are required'),
  root_cause: z.string().min(1, 'Root cause is required'),
  fix: z.string().min(1, 'Fix is required'),
  severity: Severity.optional().default('medium'),
  status: z.enum(['open', 'fixed', 'wont-fix', 'workaround']).optional().default('fixed'),
  tags: Tags,
  files: Files,
  related: z.array(RelatedEntry).optional().default([]),
  validation: z.string().optional()
});

export const RecordImplementationSchema = z.object({
  title: Title,
  description: z.string().min(1, 'Description is required'),
  key_details: z.string().optional(),
  why: z.string().optional(),
  tags: Tags,
  files: Files,
  related: z.array(RelatedEntry).optional().default([]),
  validation: z.string().optional()
});

export const RecordPatternSchema = z.object({
  title: Title,
  pattern: z.string().min(1, 'Pattern description is required'),
  example: z.string().optional(),
  tags: Tags,
  related: z.array(RelatedEntry).optional().default([])
});

export const RecordLessonSchema = z.object({
  title: Title,
  what_happened: z.string().min(1, 'What happened is required'),
  lesson: z.string().min(1, 'Lesson is required'),
  rule: z.string().min(1, 'Rule is required'),
  trigger: Trigger.optional().default('discovery'),
  severity: LessonSeverity.optional().default('medium'),
  tags: Tags,
  files: Files,
  related: z.array(RelatedEntry).optional().default([])
});

export const RecordPlanSchema = z.object({
  title: Title,
  scope: z.string().min(1, 'Scope is required'),
  implemented: z.array(z.string()).optional(),
  deferred: z.array(z.object({
    item: z.string().min(1),
    reason: z.string().min(1)
  })).optional(),
  next_steps: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  status: z.enum(['planned', 'in_progress', 'partial', 'completed', 'abandoned']).optional().default('partial'),
  tags: Tags,
  files: Files,
  related: z.array(RelatedEntry).optional().default([])
});

export const RecordResearchSchema = z.object({
  title: Title,
  alternatives: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1)
  })).min(1, 'At least one alternative required'),
  rejected: z.array(z.object({
    name: z.string().min(1),
    reason: z.string().min(1)
  })).optional().default([]),
  conclusion: z.string().min(1, 'Conclusion is required'),
  agent_data: z.string().optional(),
  tags: Tags,
  files: Files,
  related: z.array(RelatedEntry).optional().default([])
});

export const UpdateEntrySchema = z.object({
  id: EntryId,
  status: z.string().min(1).optional(),
  title: Title.optional(),
  content: z.string().optional(),
  add_related: z.array(RelatedEntry).optional()
});

export const LinkEntriesSchema = z.object({
  from: EntryId,
  to: EntryId,
  rel: RelationType
});

export const SearchSchema = z.object({
  query: z.string(),
  type: z.enum(['decision', 'bug', 'implementation', 'pattern', 'plan', 'lesson', 'research']).optional(),
  tags: z.array(z.string()).optional(),
  compact: z.boolean().optional()
});

export const GetEntrySchema = z.object({
  id: EntryId
});

export const CheckConflictsSchema = z.object({
  proposed_change: z.string().min(1, 'Proposed change description is required'),
  affected_files: z.array(z.string()).optional().default([])
});

export const ReviewEntrySchema = z.object({
  id: EntryId,
  notes: z.string().optional()
});

export const UpdatePlanSchema = z.object({
  id: EntryId,
  completed_items: z.array(z.string()).optional(),
  new_deferred: z.array(z.object({
    item: z.string().min(1),
    reason: z.string().min(1)
  })).optional(),
  new_implemented: z.array(z.string()).optional(),
  status: z.enum(['planned', 'in_progress', 'partial', 'completed', 'abandoned']).optional(),
  next_steps: z.string().optional()
});

export const TraverseGraphSchema = z.object({
  mode: z.enum(['traverse', 'path', 'impact', 'cycles']),
  start_id: EntryId.optional(),
  target_id: EntryId.optional(),
  max_depth: z.number().int().min(1).max(10).optional().default(3),
  rel_types: z.array(RelationType).optional()
});

export const AutoDocumentSchema = z.object({
  since: z.string().optional(),
  dry_run: z.boolean().optional().default(true)
});

export const PreflightSchema = z.object({
  files: z.array(z.string().min(1)).min(1, 'At least one file required'),
  intent: z.string().optional()
});

export const ValidateChangeSchema = z.object({
  files: z.array(z.string().min(1)).min(1, 'At least one file required'),
  change_description: z.string().min(1, 'Change description is required'),
  changes_summary: z.string().optional()
});

export const RebuildRulesSchema = z.object({});

// ── Schema map for handleTool validation ──

export const TOOL_SCHEMAS = {
  brain_record_decision: RecordDecisionSchema,
  brain_record_bug: RecordBugSchema,
  brain_record_implementation: RecordImplementationSchema,
  brain_record_pattern: RecordPatternSchema,
  brain_record_lesson: RecordLessonSchema,
  brain_record_plan: RecordPlanSchema,
  brain_record_research: RecordResearchSchema,
  brain_update_entry: UpdateEntrySchema,
  brain_link_entries: LinkEntriesSchema,
  brain_search: SearchSchema,
  brain_get_entry: GetEntrySchema,
  brain_check_conflicts: CheckConflictsSchema,
  brain_review_entry: ReviewEntrySchema,
  brain_update_plan: UpdatePlanSchema,
  brain_traverse_graph: TraverseGraphSchema,
  brain_auto_document: AutoDocumentSchema,
  brain_preflight: PreflightSchema,
  brain_validate_change: ValidateChangeSchema,
  brain_rebuild_rules: RebuildRulesSchema
};

/**
 * Validate tool arguments against schema.
 * Returns { success: true, data } or { success: false, error: string }
 */
export function validateToolArgs(toolName, args) {
  const schema = TOOL_SCHEMAS[toolName];
  if (!schema) return { success: true, data: args };

  const result = schema.safeParse(args);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
  return { success: false, error: `Validation error: ${issues}` };
}
