#!/usr/bin/env node
/**
 * Brain PreToolUse Hook — Cognitive Firewall rule injection
 *
 * Triggered before file-modifying tools (Write, Edit, MultiEdit).
 * Reads rules from index.json and injects relevant ones into context.
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

        // Try to read rules from index.json
        const brainPath = process.env.BRAIN_PROJECT_PATH
            ? join(process.env.BRAIN_PROJECT_PATH, '.brain')
            : null;

        let rulesText = '';
        if (brainPath) {
            try {
                const indexData = JSON.parse(await readFile(join(brainPath, 'index.json'), 'utf-8'));
                if (indexData.rules) {
                    const rules = findRulesForFile(filePath, indexData.rules);
                    if (rules.length > 0) {
                        // Sort by severity, show max 5
                        const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                        rules.sort((a, b) => (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2));
                        const top = rules.slice(0, 5);

                        rulesText = `\n\n`;
                        for (const rule of top) {
                            const icon = { DO: 'DO', DONT: 'DONT', GUARD: 'GUARD' }[rule.type] || 'RULE';
                            rulesText += `[${icon}] ${rule.text} (${rule.source_id})\n`;
                        }
                        if (rules.length > 5) {
                            rulesText += `... and ${rules.length - 5} more rules\n`;
                        }
                        rulesText += `\nFull context: call brain_preflight({ files: ["${filePath}"] })`;
                    }
                }
            } catch {
                // index.json not readable, fall back to reminder
            }
        }

        const baseMessage = `BRAIN FIREWALL: Editing "${filePath}"`;
        const fallback = rulesText
            ? baseMessage + rulesText
            : `${baseMessage}\nHave you called brain_preflight for this file? It is MANDATORY before edits.`;

        const output = {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext: fallback
            }
        };
        console.log(JSON.stringify(output));
    } catch {
        // On error, don't block
        process.exit(0);
    }
});

/**
 * Find rules matching a file path using suffix matching
 */
function findRulesForFile(filePath, rulesData) {
    const result = [];
    const norm = filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

    // Global rules
    if (rulesData.global && Array.isArray(rulesData.global)) {
        result.push(...rulesData.global);
    }

    // File-specific rules
    if (rulesData.byFile) {
        for (const [indexedFile, rules] of Object.entries(rulesData.byFile)) {
            // Suffix match with segment boundary
            if (norm === indexedFile) {
                result.push(...rules);
            } else if (norm.endsWith(indexedFile)) {
                const charBefore = norm[norm.length - indexedFile.length - 1];
                if (charBefore === '/' || charBefore === undefined) {
                    result.push(...rules);
                }
            } else if (indexedFile.endsWith(norm)) {
                const charBefore = indexedFile[indexedFile.length - norm.length - 1];
                if (charBefore === '/' || charBefore === undefined) {
                    result.push(...rules);
                }
            }
        }
    }

    return result;
}
