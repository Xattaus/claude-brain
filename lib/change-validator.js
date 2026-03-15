/**
 * ChangeValidator — Post-edit validation against brain rules
 *
 * Checks whether a described change violates GUARD, DONT, or DO rules
 * using keyword overlap / semantic similarity.
 */

export class ChangeValidator {
  /**
   * Validate a change description against rules
   * @param {object[]} rules - Rules from RuleIndex.getRulesForFiles()
   * @param {string} changeDescription - What was changed
   * @param {string} [changesSummary] - Detailed summary of changes
   * @returns {{ passed: boolean, violations: object[], warnings: object[], recommendations: string[] }}
   */
  validate(rules, changeDescription, changesSummary) {
    const violations = [];
    const warnings = [];
    const recommendations = [];
    const fullText = `${changeDescription} ${changesSummary || ''}`.toLowerCase();
    const changeWords = extractWords(fullText);

    for (const rule of rules) {
      const ruleWords = extractWords(rule.text.toLowerCase());

      if (rule.type === 'GUARD') {
        // GUARD rules: check if change might reintroduce a fixed bug
        const similarity = jaccardSimilarity(changeWords, ruleWords);
        // Also check for direct keyword overlap
        const keyOverlap = keywordOverlap(fullText, rule.text.toLowerCase());

        if (similarity > 0.25 || keyOverlap >= 2) {
          violations.push({
            type: 'REGRESSIORISKI',
            rule,
            reason: `Muutos saattaa tuoda takaisin korjatun bugin`,
            similarity: Math.round(similarity * 100)
          });
        }
      } else if (rule.type === 'DONT') {
        // DONT rules: check if change description contains forbidden keywords
        const keyOverlap = keywordOverlap(fullText, rule.text.toLowerCase());
        const similarity = jaccardSimilarity(changeWords, ruleWords);

        if (keyOverlap >= 2 || similarity > 0.3) {
          violations.push({
            type: 'SÄÄNTÖRIKKOMUS',
            rule,
            reason: `Muutos rikkoo DONT-sääntöä`,
            similarity: Math.round(similarity * 100)
          });
        }
      } else if (rule.type === 'DO') {
        // DO rules: generate warnings if change touches relevant area
        // but doesn't seem to follow the rule
        const similarity = jaccardSimilarity(changeWords, ruleWords);
        if (similarity > 0.2 && similarity < 0.5) {
          warnings.push({
            type: 'TARKISTA',
            rule,
            reason: `Varmista DO-säännön noudattaminen`
          });
        }
      }
    }

    // Generate recommendations
    if (violations.length > 0) {
      const guardViolations = violations.filter(v => v.type === 'REGRESSIORISKI');
      for (const v of guardViolations) {
        recommendations.push(`Tarkista ${v.rule.source_id}:n korjaus ennen jatkamista`);
      }
      recommendations.push('Jos tarkoituksellinen muutos, tallenna uusi päätös brain_record_decision:lla');
    }

    // Check for active decisions that cover these files
    const decisionRules = rules.filter(r => r.source_type === 'decision');
    if (decisionRules.length > 0) {
      const decIds = [...new Set(decisionRules.map(r => r.source_id))];
      warnings.push({
        type: 'PÄÄTÖS',
        rule: null,
        reason: `Aktiivinen päätös ${decIds.join(', ')} koskee näitä tiedostoja`
      });
    }

    return {
      passed: violations.length === 0,
      violations,
      warnings,
      recommendations
    };
  }
}

// ── Helpers ──

/**
 * Extract significant words (>2 chars) from text
 */
function extractWords(text) {
  return new Set(
    text.split(/[\s,.:;!?()[\]{}"'`]+/)
      .map(w => w.trim())
      .filter(w => w.length > 2)
  );
}

/**
 * Jaccard similarity between two word sets
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Count significant keyword overlaps between two texts
 */
function keywordOverlap(textA, textB) {
  const wordsA = extractWords(textA);
  const wordsB = extractWords(textB);
  let count = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) count++;
  }
  return count;
}
