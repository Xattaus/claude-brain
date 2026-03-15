#!/usr/bin/env node
/**
 * Brain PostToolUse Hook — Automatic documentation reminder
 *
 * Triggered after file-modifying tools complete.
 * Reminds Claude to consider recording the change as a brain entry.
 */

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);
        const toolName = data.tool_name || '';

        // Only trigger for file-modifying tools
        const fileTools = ['Write', 'Edit', 'MultiEdit', 'write_to_file', 'replace_file_content', 'multi_replace_file_content'];
        if (!fileTools.includes(toolName)) {
            process.exit(0);
            return;
        }

        // Extract file path from tool input
        const toolInput = data.tool_input || {};
        const filePath = toolInput.file_path || toolInput.TargetFile || toolInput.path || '';

        if (!filePath || filePath.includes('.brain/')) {
            process.exit(0);
            return;
        }

        const output = {
            hookSpecificOutput: {
                hookEventName: "PostToolUse",
                additionalContext: `BRAIN: You edited "${filePath}". ` +
                    `Was this a significant change? Consider recording it: ` +
                    `brain_record_decision (architecture decision), ` +
                    `brain_record_implementation (implementation), ` +
                    `brain_record_bug (bug fix), ` +
                    `brain_record_lesson (lesson learned). ` +
                    `Use brain_link_entries to connect new entries to existing ones.`
            }
        };
        console.log(JSON.stringify(output));
    } catch {
        process.exit(0);
    }
});
