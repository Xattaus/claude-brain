#!/usr/bin/env node
/**
 * Brain Session Start Hook
 * 
 * Called by Claude Code's SessionStart hook.
 * Outputs a reminder to Claude's context to use brain tools.
 * The output goes to Claude's additionalContext via stdout.
 */

const message = `🧠 BRAIN ACTIVE — Muista:
1. Kutsu brain_get_overview saadaksesi projektin yleiskuvan
2. Kutsu brain_get_backlog nähdäksesi keskeneräiset suunnitelmat
3. Käytä brain_check_conflicts ENNEN muutoksia
4. Tallenna päätökset, bugit ja toteutukset aivoihin`;

// Output as JSON for SessionStart additionalContext
const output = {
    hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: message
    }
};

console.log(JSON.stringify(output));
process.exit(0);
