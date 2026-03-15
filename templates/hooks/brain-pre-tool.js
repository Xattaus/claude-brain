#!/usr/bin/env node
/**
 * Brain PreToolUse Hook — Cognitive Firewall context injection
 *
 * Triggered before file-modifying tools (Write, Edit, MultiEdit).
 * Instead of asking "have you called brain_preflight?", this hook
 * PERFORMS the check itself and injects actual context:
 *   - Matching rules (DO/DONT/GUARD)
 *   - Related entries (decisions, bugs, implementations) for the file
 *   - Active lessons (high severity)
 *   - Risk score
 *
 * Philosophy: Present information for Claude to evaluate, don't block.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
    try {
        const data = JSON.parse(input);
        const toolName = data.tool_name || '';

        // Only trigger for file-modifying tools
        const fileTools = ['Write', 'Edit', 'MultiEdit', 'write_to_file', 'replace_file_content', 'multi_replace_file_content'];
        if (!fileTools.includes(toolName)) {
            process.exit(0);
            return;
        }

        // Extract file path from tool input
        const toolInput = data.tool_input || {};
        const filePath = toolInput.file_path || toolInput.TargetFile || toolInput.path || '';

        if (!filePath || filePath.includes('.brain/')) {
            // Don't trigger for brain files themselves
            process.exit(0);
            return;
        }

        // Try to read index.json and build full context
        const brainPath = process.env.BRAIN_PROJECT_PATH
            ? join(process.env.BRAIN_PROJECT_PATH, '.brain')
            : null;

        if (!brainPath) {
            process.exit(0);
            return;
        }

        let indexData;
        try {
            indexData = JSON.parse(await readFile(join(brainPath, 'index.json'), 'utf-8'));
        } catch {
            // No index.json — nothing to inject
            process.exit(0);
            return;
        }

        const norm = filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        const sections = [];

        // ── 1. Find matching rules ──
        const rules = findRulesForFile(norm, indexData.rules);
        const dontRules = rules.filter(r => r.type === 'DONT' || r.type === 'GUARD');
        const doRules = rules.filter(r => r.type === 'DO');

        if (dontRules.length > 0) {
            sections.push('CONSTRAINTS:');
            for (const rule of dontRules.slice(0, 5)) {
                const icon = rule.type === 'GUARD' ? 'GUARD' : 'DONT';
                sections.push(`  [${icon}] ${rule.text} (from ${rule.source_id})`);
            }
        }
        if (doRules.length > 0) {
            sections.push('REQUIREMENTS:');
            for (const rule of doRules.slice(0, 3)) {
                sections.push(`  [DO] ${rule.text} (from ${rule.source_id})`);
            }
        }

        // ── 2. Find related entries (decisions, bugs, implementations) for this file ──
        const entries = indexData.entries || [];
        const relatedEntries = entries.filter(e =>
            e.files && e.files.some(ef => pathMatches(norm, ef.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()))
        );

        const activeDecisions = relatedEntries.filter(e => e.type === 'decision' && e.status === 'active');
        const openBugs = relatedEntries.filter(e => e.type === 'bug' && e.status === 'open');
        const fixedBugs = relatedEntries.filter(e => e.type === 'bug' && e.status === 'fixed');
        const implementations = relatedEntries.filter(e => e.type === 'implementation' && e.status === 'current');

        if (activeDecisions.length > 0) {
            sections.push('ACTIVE DECISIONS for this file:');
            for (const d of activeDecisions.slice(0, 3)) {
                sections.push(`  - ${d.id}: ${d.title}`);
            }
        }

        if (openBugs.length > 0) {
            sections.push('OPEN BUGS in this file:');
            for (const b of openBugs.slice(0, 3)) {
                sections.push(`  - ${b.id} [${b.severity || 'medium'}]: ${b.title}`);
            }
        }

        if (fixedBugs.length > 0) {
            sections.push('FIXED BUGS (do not reintroduce):');
            for (const b of fixedBugs.slice(0, 3)) {
                sections.push(`  - ${b.id}: ${b.title}`);
            }
        }

        if (implementations.length > 0) {
            sections.push('CURRENT IMPLEMENTATIONS:');
            for (const i of implementations.slice(0, 2)) {
                sections.push(`  - ${i.id}: ${i.title}`);
            }
        }

        // ── 3. Active high-severity lessons ──
        const lessons = entries.filter(e =>
            e.type === 'lesson' && e.status === 'active' && (e.severity === 'high' || e.severity === 'critical')
        );

        if (lessons.length > 0) {
            sections.push('LESSONS (high severity):');
            for (const l of lessons.slice(0, 3)) {
                const ruleText = l.rule || l.title;
                sections.push(`  - ${l.id}: ${ruleText}`);
            }
        }

        // ── 4. Risk score ──
        const riskScore = calculateRiskScore({
            activeDecisions,
            openBugs,
            fixedBugs,
            rules: dontRules,
            lessons
        });
        const riskLabel = riskScore < 15 ? 'SAFE' : riskScore < 40 ? 'LOW' : riskScore < 70 ? 'MEDIUM' : 'HIGH';

        // ── Build final context ──
        if (sections.length === 0) {
            // No relevant brain data for this file — nothing to inject
            process.exit(0);
            return;
        }

        let contextText = `BRAIN CONTEXT for "${shortPath(filePath)}" [RISK: ${riskLabel} (${riskScore})]:\n`;
        contextText += sections.join('\n');

        if (riskScore >= 70) {
            contextText += '\n⚠ HIGH RISK — Review all constraints above carefully before proceeding. Consider asking the user.';
        } else if (riskScore >= 40) {
            contextText += '\nMEDIUM RISK — Ensure your edit respects the constraints and decisions above.';
        }

        // For full context: suggest brain_get_context_for_files for deep dive
        if (activeDecisions.length > 3 || relatedEntries.length > 8) {
            contextText += `\nMore entries exist. Call brain_get_context_for_files(["${shortPath(filePath)}"]) for full details.`;
        }

        const output = {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext: contextText
            }
        };
        console.log(JSON.stringify(output));
    } catch {
        // On error, don't block
        process.exit(0);
    }
});

// ── Helpers ──

/**
 * Segment-boundary path matching
 */
function pathMatches(a, b) {
    if (a === b) return true;
    if (a.endsWith(b)) {
        const ch = a[a.length - b.length - 1];
        return ch === '/' || ch === undefined;
    }
    if (b.endsWith(a)) {
        const ch = b[b.length - a.length - 1];
        return ch === '/' || ch === undefined;
    }
    return false;
}

/**
 * Find rules matching a file path from serialized rules data
 */
function findRulesForFile(normPath, rulesData) {
    if (!rulesData) return [];
    const result = [];

    // Global rules
    if (rulesData.global && Array.isArray(rulesData.global)) {
        result.push(...rulesData.global);
    }

    // File-specific rules
    if (rulesData.byFile) {
        for (const [indexedFile, rules] of Object.entries(rulesData.byFile)) {
            if (pathMatches(normPath, indexedFile)) {
                result.push(...rules);
            }
        }
    }

    return result;
}

/**
 * Calculate risk score (same formula as rule-index.js)
 */
function calculateRiskScore({ activeDecisions = [], openBugs = [], fixedBugs = [], rules = [], lessons = [] }) {
    let score = 0;
    score += activeDecisions.length * 10;
    const sevScores = { critical: 25, high: 15, medium: 8, low: 4 };
    for (const bug of openBugs) score += sevScores[bug.severity || 'medium'] || 8;
    const fixSevScores = { critical: 20, high: 12, medium: 6, low: 3 };
    for (const bug of fixedBugs) score += fixSevScores[bug.severity || 'medium'] || 6;
    score += rules.length * 5;
    score += lessons.filter(l => l.severity === 'high').length * 5;
    return Math.min(100, Math.max(0, score));
}

/**
 * Shorten a file path for display
 */
function shortPath(p) {
    const parts = p.replace(/\\/g, '/').split('/');
    return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : parts.join('/');
}
