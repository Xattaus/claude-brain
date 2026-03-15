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
            reason: "🧠 Ennen lopettamista: Tarkista oletko tallentanut istunnon aikana tehdyt muutokset brain-merkinnöiksi. " +
                "Jos teit arkkitehtuuripäätöksiä, bugikorjauksia tai merkittäviä toteutuksia, kutsu vastaava brain_record_* -työkalu. " +
                "Jos istunto jäi kesken, kutsu brain_record_plan. " +
                "Jos kaikki on tallennettu, voit lopettaa."
        };

        console.log(JSON.stringify(output));
    } catch {
        // On error, don't block
        process.exit(0);
    }
});
