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
            additionalContext: "🧠 BRAIN: Säilytä tiivistämisen aikana seuraavat: " +
                "(1) Kaikki brain-merkinnät joita on tehty tämän istunnon aikana (DEC-*, BUG-*, IMPL-*, PAT-*, PLAN-*) " +
                "(2) Mahdolliset keskeneräiset brain_record_* -kutsut " +
                "(3) Ristiriitavaroitukset brain_check_conflicts -kutsuista " +
                "(4) Backlogin tila brain_get_backlog -kutsusta"
        }
    };

    console.log(JSON.stringify(output));
    process.exit(0);
});
