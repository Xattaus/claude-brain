// Format brain health report from stats object into markdown

export function formatHealthReport(stats) {
  let text = `## Brain Health Report\n\n`;
  text += `**Total entries:** ${stats.total}\n\n`;

  // By type
  text += `### Entries by type\n`;
  for (const [type, count] of Object.entries(stats.byType)) {
    text += `- ${type}: ${count}\n`;
  }
  text += '\n';

  // By status
  text += `### Entries by status\n`;
  for (const [status, count] of Object.entries(stats.byStatus)) {
    text += `- ${status}: ${count}\n`;
  }
  text += '\n';

  // Issues
  let issueCount = 0;

  if (stats.stale.length > 0) {
    issueCount += stats.stale.length;
    text += `### \u26a0 Stale entries (${stats.stale.length})\n`;
    for (const s of stats.stale) {
      text += `- **${s.id}**: ${s.title} (${s.daysSince} days since review)\n`;
    }
    text += '\n';
  }

  if (stats.orphaned.length > 0) {
    issueCount += stats.orphaned.length;
    text += `### \u26a0 Orphaned entries (${stats.orphaned.length})\n`;
    text += 'These entries have no relationships (neither incoming nor outgoing):\n';
    for (const o of stats.orphaned) {
      text += `- **${o.id}** [${o.type}]: ${o.title}\n`;
    }
    text += '\n';
  }

  if (stats.brokenLinks.length > 0) {
    issueCount += stats.brokenLinks.length;
    text += `### \u274c Broken links (${stats.brokenLinks.length})\n`;
    for (const b of stats.brokenLinks) {
      text += `- ${b.from} \u2192 ${b.to} [${b.rel}] (target not found)\n`;
    }
    text += '\n';
  }

  if (stats.missingBidirectional.length > 0) {
    issueCount += stats.missingBidirectional.length;
    text += `### \u26a0 Missing bidirectional links (${stats.missingBidirectional.length})\n`;
    for (const m of stats.missingBidirectional) {
      text += `- ${m.from} \u2192 ${m.to} [${m.rel}] (no inverse)\n`;
    }
    text += '\n';
  }

  if (stats.activeDecisionsWithoutImpl.length > 0) {
    issueCount += stats.activeDecisionsWithoutImpl.length;
    text += `### \u2139 Active decisions without implementation (${stats.activeDecisionsWithoutImpl.length})\n`;
    for (const d of stats.activeDecisionsWithoutImpl) {
      text += `- **${d.id}**: ${d.title}\n`;
    }
    text += '\n';
  }

  if (stats.oldOpenBugs.length > 0) {
    issueCount += stats.oldOpenBugs.length;
    text += `### \u26a0 Old open bugs (${stats.oldOpenBugs.length})\n`;
    for (const b of stats.oldOpenBugs) {
      text += `- **${b.id}**: ${b.title} (${b.ageDays} days old)\n`;
    }
    text += '\n';
  }

  if (stats.incompletePlans.length > 0) {
    text += `### \ud83d\udccb Incomplete plans (${stats.incompletePlans.length})\n`;
    for (const p of stats.incompletePlans) {
      text += `- **${p.id}** [${p.priority}/${p.status}]: ${p.title}\n`;
    }
    text += '\n';
  }

  if (issueCount === 0) {
    text += '\u2705 No issues found. Brain is healthy!\n';
  }

  return text;
}
