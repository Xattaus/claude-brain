#!/usr/bin/env node
/**
 * Brain Session Start Hook
 *
 * Called by Claude Code's SessionStart hook.
 * Outputs a reminder to Claude's context to use brain tools.
 * The output goes to Claude's additionalContext via stdout.
 */

const message = `BRAIN ACTIVE — Mandatory startup sequence:
1. Call brain_get_overview to load project context
2. Call brain_get_lessons to review learned lessons — DO NOT repeat past mistakes
3. Call brain_get_backlog to check incomplete plans
4. Call brain_preflight BEFORE editing any file
5. Use brain_check_conflicts BEFORE making changes`;

// Output as JSON for SessionStart additionalContext
const output = {
    hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: message
    }
};

console.log(JSON.stringify(output));
process.exit(0);
