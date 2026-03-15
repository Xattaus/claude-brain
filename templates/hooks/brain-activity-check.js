#!/usr/bin/env node
/**
 * Brain Activity Check Hook — Proactive reminder
 * 
 * PostToolUse hook that tracks tool call count.
 * If more than 10 non-brain tool calls have been made without
 * any brain tool call, injects a reminder.
 * 
 * Uses a simple counter stored in environment variable.
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
            // Reset: output nothing, just exit
            process.exit(0);
            return;
        }

        // Non-brain tools: check the counter
        // We track via a temporary file since hooks are stateless
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
                    additionalContext: `🧠 BRAIN MUISTUTUS: Olet tehnyt ${count} tool-kutsua ilman brain-kutsua. ` +
                        `Onko muutoksia joita pitäisi tallentaa? ` +
                        `Harkitse: brain_record_decision, brain_record_implementation, brain_record_bug. ` +
                        `Tai kutsu brain_check_conflicts tarkistaaksesi ristiriidat.`
                }
            };
            console.log(JSON.stringify(output));
        }
    } catch {
        process.exit(0);
    }
});
