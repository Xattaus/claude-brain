#!/usr/bin/env node
/**
 * Brain PreCompact Hook
 *
 * Called before /compact or auto-compact.
 * Outputs instructions to preserve brain-related context during compaction.
 */

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
    const output = {
        hookSpecificOutput: {
            hookEventName: "PreCompact",
            additionalContext: "BRAIN: Preserve the following during compaction: " +
                "(1) All brain entries created during this session (DEC-*, BUG-*, IMPL-*, PAT-*, PLAN-*, LES-*) " +
                "(2) Any pending brain_record_* calls " +
                "(3) Conflict warnings from brain_check_conflicts calls " +
                "(4) Backlog state from brain_get_backlog call " +
                "(5) Lessons loaded from brain_get_lessons"
        }
    };

    console.log(JSON.stringify(output));
    process.exit(0);
});
