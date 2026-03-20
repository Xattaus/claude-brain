import { calculateRiskScore, riskLabel } from '../rule-index.js';
import { ChangeValidator } from '../change-validator.js';

export const safetyHandlers = {
  brain_preflight: async (ctx, args) => {
    const { manager, checker } = ctx;

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
      text += `## RULES\n`;
      for (const rule of rules) {
        const icon = { DO: '\u2705', DONT: '\ud83d\udeab', GUARD: '\ud83d\udee1\ufe0f' }[rule.type] || '\ud83d\udccb';
        text += `${icon} ${rule.type}: ${rule.text} (${rule.source_id}${rule.severity ? ', ' + rule.severity : ''})\n`;
      }
      text += '\n';
    }

    // Active decisions
    if (activeDecisions.length > 0) {
      text += `## ACTIVE DECISIONS\n`;
      for (const d of activeDecisions) {
        text += `- ${d.id} [${d.status}]: ${d.title}\n`;
      }
      text += '\n';
    }

    // Regression risks (fixed bugs)
    if (fixedBugs.length > 0) {
      text += `## REGRESSION RISKS\n`;
      for (const b of fixedBugs) {
        text += `- ${b.id} [${b.status}, ${b.severity || 'medium'}]: ${b.title}\n`;
      }
      text += '\n';
    }

    // Open bugs
    if (openBugs.length > 0) {
      text += `## OPEN BUGS\n`;
      for (const b of openBugs) {
        text += `- ${b.id} [${b.severity || 'medium'}]: ${b.title}\n`;
      }
      text += '\n';
    }

    // Patterns
    if (grouped.patterns.length > 0) {
      text += `## PATTERNS\n`;
      for (const p of grouped.patterns) {
        text += `- ${p.id}: ${p.title}\n`;
      }
      text += '\n';
    }

    // Lessons
    if (lessons.length > 0) {
      text += `## LESSONS\n`;
      for (const l of lessons) {
        text += `- ${l.id} [${l.severity || 'medium'}]: ${l.title}`;
        if (l.rule) text += ` \u2014 ${l.rule}`;
        text += '\n';
      }
      text += '\n';
    }

    // Intent conflicts
    if (conflicts.length > 0) {
      text += `## CONFLICTS\n`;
      for (const c of conflicts) {
        text += `- \u26a0 ${c.entry_id}: ${c.title} \u2014 ${c.reason}\n`;
      }
      text += '\n';
    }
    if (warnings.length > 0) {
      text += `## WARNINGS\n`;
      for (const w of warnings) {
        text += `- \u2139 ${w.entry_id}: ${w.title} \u2014 ${w.reason}\n`;
      }
      text += '\n';
    }

    if (rules.length === 0 && activeDecisions.length === 0 && fixedBugs.length === 0 && openBugs.length === 0) {
      text += 'No rules or context for these files.\n';
    }

    return [{ type: 'text', text }];
  },

  brain_validate_change: async (ctx, args) => {
    const { manager, tfidf } = ctx;

    // Ensure rule index is loaded
    await manager.loadRuleIndex();

    const rules = manager.ruleIndex.getRulesForFiles(args.files);
    const validator = new ChangeValidator(tfidf);
    const result = validator.validate(rules, args.change_description, args.changes_summary);

    const status = result.passed ? 'PASS' : 'FAIL';
    let text = `# VALIDATION: ${status}`;
    if (!result.passed) {
      text += ` (${result.violations.length} violation${result.violations.length > 1 ? 's' : ''})`;
    }
    if (result.warnings.length > 0) {
      text += ` (${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''})`;
    }
    text += '\n\n';

    if (result.violations.length > 0) {
      text += `## VIOLATIONS\n`;
      for (let i = 0; i < result.violations.length; i++) {
        const v = result.violations[i];
        text += `${i + 1}. ${v.type}: "${args.change_description}" may violate rule\n`;
        text += `   Rule: ${v.rule.type} \u2014 "${v.rule.text}" (${v.rule.source_id})\n`;
      }
      text += '\n';
    }

    if (result.warnings.length > 0) {
      text += `## WARNINGS\n`;
      for (let i = 0; i < result.warnings.length; i++) {
        const w = result.warnings[i];
        text += `${i + 1}. ${w.reason}\n`;
      }
      text += '\n';
    }

    if (result.recommendations.length > 0) {
      text += `## RECOMMENDATIONS\n`;
      for (const rec of result.recommendations) {
        text += `- ${rec}\n`;
      }
      text += '\n';
    }

    if (result.passed && result.warnings.length === 0) {
      text += 'No violations. Changes comply with all rules.\n';
    }

    return [{ type: 'text', text }];
  },

  brain_rebuild_rules: async (ctx, args) => {
    const { manager } = ctx;
    const stats = await manager.rebuildRuleIndex();
    let text = `Rule index rebuilt: ${stats.totalRules} rules extracted\n`;
    text += `- ${stats.doCount} DO rules, ${stats.dontCount} DONT rules, ${stats.guardCount} GUARD rules\n`;
    text += `- Files covered: ${stats.filesCovered}\n`;
    return [{ type: 'text', text }];
  },

  brain_restore_snapshot: async (ctx, args) => {
    const { manager } = ctx;
    try {
      const result = await manager.restoreSnapshot(args.name);
      let text = `## Snapshot Restored\n\n`;
      text += `**From:** ${args.name}\n`;
      text += `**Entries restored:** ${result.entriesCount}\n\n`;
      text += `\u26a0\ufe0f A backup was created before restoring. Use brain_list_snapshots to see it.`;
      return [{ type: 'text', text }];
    } catch (err) {
      return [{ type: 'text', text: `Error restoring snapshot: ${err.message}` }];
    }
  }
};
