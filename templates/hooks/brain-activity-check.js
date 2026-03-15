#!/usr/bin/env node
/**
 * Brain Activity Check Hook — Proactive reminder
 *
 * PostToolUse hook that tracks tool call count.
 * If more than 10 non-brain tool calls have been made without
 * any brain tool call, injects a reminder.
 *
 * Uses a simple counter stored in a temp file since hooks are stateless.
 */

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);
        const toolName = data.tool_name || '';

        // Brain tools reset the counter
        if (toolName.startsWith('brain_')) {
            const fs = require('fs');
            const path = require('path');
            const counterFile = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', '.brain-activity-counter');
            try { fs.writeFileSync(counterFile, '0', 'utf-8'); } catch { /* ignore */ }
            process.exit(0);
            return;
        }

        // Non-brain tools: check the counter
        const fs = require('fs');
        const path = require('path');
        const counterFile = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', '.brain-activity-counter');

        let count = 0;
        try {
            count = parseInt(fs.readFileSync(counterFile, 'utf-8')) || 0;
        } catch { /* first time */ }

        count++;
        fs.writeFileSync(counterFile, String(count), 'utf-8');

        // Only remind every 10 calls
        if (count >= 10 && count % 10 === 0) {
            const output = {
                hookSpecificOutput: {
                    hookEventName: "PostToolUse",
                    additionalContext: `BRAIN REMINDER: You have made ${count} tool calls without any brain call. ` +
                        `Are there changes that should be recorded? ` +
                        `Consider: brain_record_decision, brain_record_implementation, brain_record_bug, brain_record_lesson. ` +
                        `Or call brain_check_conflicts to verify no conflicts exist.`
                }
            };
            console.log(JSON.stringify(output));
        }
    } catch {
        process.exit(0);
    }
});
