// Recording handlers: record_decision, record_bug, record_implementation, record_pattern, record_lesson

import { buildDecisionBody, buildBugBody, buildImplementationBody, buildPatternBody, buildLessonBody } from '../utils/body-builders.js';

export const recordingHandlers = {
  brain_record_decision: async (ctx, args) => {
    const { manager, session, t } = ctx;

    // Duplicate check
    const decDupes = await manager.checkDuplicate(args.title, 'decision');
    let decDupeWarn = '';
    if (decDupes.length > 0) {
      decDupeWarn = `\n\u26a0\ufe0f Similar entries: ${decDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
    }

    // Build related array from explicit relations + supersedes shorthand
    const relatedInput = args.related || [];
    if (args.supersedes) {
      relatedInput.push({ id: args.supersedes, rel: 'supersedes' });
    }

    const body = buildDecisionBody(args, t);
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
      } catch (err) {
        process.stderr.write(`[brain] Warning: Failed to link ${result.id} -> ${rel.id}: ${err.message}\n`);
      }
    }

    // Extract rules for cognitive firewall
    try {
      await manager.addRulesForEntry(result._indexEntry, body);
    } catch { /* non-critical */ }

    session.trackChange('decision', result.id, args.title);
    return [{ type: 'text', text: `Decision recorded: ${result.id} \u2192 ${result.path}${decDupeWarn}` }];
  },

  brain_record_bug: async (ctx, args) => {
    const { manager, session, t } = ctx;

    // Duplicate check
    const bugDupes = await manager.checkDuplicate(args.title, 'bug');
    let bugDupeWarn = '';
    if (bugDupes.length > 0) {
      bugDupeWarn = `\n\u26a0\ufe0f Similar entries: ${bugDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
    }

    const relatedInput = args.related || [];
    const body = buildBugBody(args, t);
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
      } catch (err) {
        process.stderr.write(`[brain] Warning: Failed to link ${result.id} -> ${rel.id}: ${err.message}\n`);
      }
    }

    // Extract rules for cognitive firewall
    try {
      await manager.addRulesForEntry(result._indexEntry, body);
    } catch { /* non-critical */ }

    session.trackChange('bug', result.id, args.title);
    return [{ type: 'text', text: `Bug recorded: ${result.id} \u2192 ${result.path}${bugDupeWarn}` }];
  },

  brain_record_implementation: async (ctx, args) => {
    const { manager, session, t } = ctx;

    // Duplicate check
    const implDupes = await manager.checkDuplicate(args.title, 'implementation');
    let implDupeWarn = '';
    if (implDupes.length > 0) {
      implDupeWarn = `\n\u26a0\ufe0f Similar entries: ${implDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
    }

    const relatedInput = args.related || [];
    const body = buildImplementationBody(args, t);
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
      } catch (err) {
        process.stderr.write(`[brain] Warning: Failed to link ${result.id} -> ${rel.id}: ${err.message}\n`);
      }
    }

    // Extract rules for cognitive firewall
    try {
      await manager.addRulesForEntry(result._indexEntry, body);
    } catch { /* non-critical */ }

    session.trackChange('implementation', result.id, args.title);
    return [{ type: 'text', text: `Implementation recorded: ${result.id} \u2192 ${result.path}${implDupeWarn}` }];
  },

  brain_record_pattern: async (ctx, args) => {
    const { manager, session, t } = ctx;

    // Duplicate check
    const patDupes = await manager.checkDuplicate(args.title, 'pattern');
    let patDupeWarn = '';
    if (patDupes.length > 0) {
      patDupeWarn = `\n\u26a0\ufe0f Similar entries: ${patDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
    }

    const relatedInput = args.related || [];
    const body = buildPatternBody(args, t);
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
      } catch (err) {
        process.stderr.write(`[brain] Warning: Failed to link ${result.id} -> ${rel.id}: ${err.message}\n`);
      }
    }

    // Extract rules for cognitive firewall
    try {
      await manager.addRulesForEntry(result._indexEntry, body);
    } catch { /* non-critical */ }

    session.trackChange('pattern', result.id, args.title);
    return [{ type: 'text', text: `Pattern recorded: ${result.id} \u2192 ${result.path}${patDupeWarn}` }];
  },

  brain_record_lesson: async (ctx, args) => {
    const { manager, session, t } = ctx;

    // Duplicate check
    const lesDupes = await manager.checkDuplicate(args.title, 'lesson');
    let lesDupeWarn = '';
    if (lesDupes.length > 0) {
      lesDupeWarn = `\n\u26a0\ufe0f Similar entries: ${lesDupes.map(d => `${d.id} "${d.title}" (${d.similarity * 100}%)`).join(', ')}`;
    }

    const relatedInput = args.related || [];
    const body = buildLessonBody(args, t);
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
      } catch (err) {
        process.stderr.write(`[brain] Warning: Failed to link ${result.id} -> ${rel.id}: ${err.message}\n`);
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

    session.trackChange('lesson', result.id, args.title);
    return [{ type: 'text', text: `Lesson recorded: ${result.id} \u2192 ${result.path}${lesDupeWarn}` }];
  }
};
