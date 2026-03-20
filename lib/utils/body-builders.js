// Body builder functions for brain entry markdown content
// Each function takes (args, t) where t is the translator function

export function buildDecisionBody(args, t) {
  let body = `## ${t('context')}\n${args.context}\n\n`;
  body += `## ${t('decision')}\n${args.decision}\n\n`;

  if (Array.isArray(args.alternatives) && args.alternatives.length > 0) {
    body += `## ${t('alternatives')}\n`;
    for (let i = 0; i < args.alternatives.length; i++) {
      body += `${i + 1}. ${args.alternatives[i]}\n`;
    }
    body += '\n';
  }

  if (Array.isArray(args.consequences) && args.consequences.length > 0) {
    body += `## ${t('consequences')}\n`;
    for (const c of args.consequences) {
      body += `- ${c}\n`;
    }
    body += '\n';
  }

  if (Array.isArray(args.files) && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  if (args.validation) {
    body += `## ${t('validation')}\n\`\`\`\n${args.validation}\n\`\`\`\n`;
  }

  return body;
}

export function buildBugBody(args, t) {
  let body = `## ${t('symptoms')}\n${args.symptoms}\n\n`;
  body += `## ${t('root_cause')}\n${args.root_cause}\n\n`;
  body += `## ${t('fix')}\n${args.fix}\n\n`;

  if (Array.isArray(args.files) && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  if (args.validation) {
    body += `## ${t('regression_test')}\n\`\`\`\n${args.validation}\n\`\`\`\n`;
  }

  return body;
}

export function buildImplementationBody(args, t) {
  let body = `## ${t('description')}\n${args.description}\n\n`;

  if (args.key_details) {
    body += `## ${t('key_details')}\n${args.key_details}\n\n`;
  }

  if (args.why) {
    body += `## ${t('why')}\n${args.why}\n\n`;
  }

  if (Array.isArray(args.files) && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  if (args.validation) {
    body += `## ${t('validation')}\n\`\`\`\n${args.validation}\n\`\`\`\n`;
  }

  return body;
}

export function buildPatternBody(args, t) {
  let body = `## ${t('pattern')}\n${args.pattern}\n\n`;

  if (args.example) {
    body += `## ${t('example')}\n\`\`\`\n${args.example}\n\`\`\`\n`;
  }

  return body;
}

export function buildLessonBody(args, t) {
  let body = `## ${t('what_happened')}\n${args.what_happened}\n\n`;
  body += `## ${t('lesson')}\n${args.lesson}\n\n`;
  body += `## ${t('rule')}\n${args.rule}\n\n`;

  if (args.trigger) {
    body += `## ${t('trigger_label')}\n${args.trigger}\n\n`;
  }

  if (Array.isArray(args.files) && args.files.length > 0) {
    body += `## ${t('files')}\n`;
    for (const f of args.files) {
      body += `- ${f}\n`;
    }
    body += '\n';
  }

  return body;
}

export function buildPlanBody(args, t) {
  let body = `## ${t('original_plan')}\n\n${args.scope}\n\n`;

  body += `## ${t('implemented')}\n\n`;
  if (Array.isArray(args.implemented) && args.implemented.length > 0) {
    for (const item of args.implemented) {
      body += `- [x] ${item}\n`;
    }
  } else {
    body += `${t('not_implemented')}\n`;
  }
  body += '\n';

  body += `## ${t('deferred')}\n\n`;
  if (Array.isArray(args.deferred) && args.deferred.length > 0) {
    for (const d of args.deferred) {
      body += `- [ ] ${d.item} (syy: ${d.reason})\n`;
    }
  } else {
    body += `${t('not_deferred')}\n`;
  }
  body += '\n';

  body += `## ${t('next_steps')}\n\n`;
  body += (args.next_steps || t('not_defined')) + '\n';

  return body;
}
