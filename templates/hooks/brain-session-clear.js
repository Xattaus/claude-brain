#!/usr/bin/env node
/**
 * Brain Session Clear Hook
 * 
 * Called by Claude Code's SessionStart hook when source is "clear" (/clear).
 * After context is cleared, this injects instructions to check
 * if any brain entries from the previous session were left unsaved.
 */

const message = `🧠 KONTEKSTI TYHJENNETTY — Tarkista aivojen tila:
1. Kutsu brain_get_overview tarkistaaksesi projektin tilan
2. Kutsu brain_get_backlog nähdäksesi keskeneräiset suunnitelmat
3. Jos edellisessä istunnossa tehtiin muutoksia, tarkista onko ne tallennettu brain-merkinnöiksi
4. Jos merkintöjä puuttuu, luo ne nyt (brain_record_decision, brain_record_bug, brain_record_implementation, brain_record_plan)
5. Käytä brain_mine_sessions löytääksesi viimeisimmän istunnon kontekstin`;

const output = {
    hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: message
    }
};

console.log(JSON.stringify(output));
process.exit(0);
