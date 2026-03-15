#!/usr/bin/env node
/**
 * Brain Stop Hook
 *
 * Called by Claude Code's Stop hook.
 * Reads stdin for stop context, then checks if there are
 * undocumented changes that should be saved to brain.
 *
 * Uses "block" decision to prevent stopping if brain work is detected
 * but not yet saved. The reason is shown to Claude who then saves.
 */

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);

        // Don't block if this is already a stop-hook re-run
        if (data.stop_hook_active) {
            process.exit(0);
            return;
        }

        // Output a reminder — Claude will see this and decide whether to save
        const output = {
            decision: "block",
            reason: "BRAIN: Before stopping, verify that all changes from this session have been saved as brain entries. " +
                "If you made architecture decisions, bug fixes, or significant implementations, call the corresponding brain_record_* tool. " +
                "If work is incomplete, call brain_record_plan to save the plan and deferred tasks. " +
                "If everything has been saved, you may stop."
        };

        console.log(JSON.stringify(output));
    } catch {
        // On error, don't block
        process.exit(0);
    }
});
