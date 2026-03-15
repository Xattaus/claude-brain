#!/usr/bin/env node
/**
 * Brain Session Clear Hook
 *
 * Called by Claude Code's SessionStart hook when source is "clear" (/clear).
 * After context is cleared, this injects instructions to check
 * if any brain entries from the previous session were left unsaved.
 */

const message = `BRAIN: Context cleared — Recovery sequence:
1. Call brain_get_overview to check project state
2. Call brain_get_lessons to reload learned lessons
3. Call brain_get_backlog to see incomplete plans
4. If previous session had changes, verify they were saved as brain entries
5. If entries are missing, create them now (brain_record_decision, brain_record_bug, brain_record_implementation, brain_record_plan)
6. Use brain_mine_sessions to extract context from the last session`;

const output = {
    hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: message
    }
};

console.log(JSON.stringify(output));
process.exit(0);
