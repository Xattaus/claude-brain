/**
 * ChangeValidator — Post-edit validation against brain rules
 *
 * Checks whether a described change violates GUARD, DONT, or DO rules
 * using keyword overlap / semantic similarity.
 */

import { extractWordSet, weightedJaccard } from './word-processing.js';

export class ChangeValidator {
  /**
   * @param {import('./tfidf.js').TfIdf} [tfidf] - Optional TF-IDF instance for weighted Jaccard
   */
  constructor(tfidf) {
    this.tfidf = tfidf || null;
  }

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
    const fullText = `${changeDescription} ${changesSummary || ''}`;
    const changeWords = extractWordSet(fullText);
    const idfWeights = this.tfidf?.getWeights() || null;

    for (const rule of (Array.isArray(rules) ? rules : [])) {
      const ruleWords = extractWordSet(rule.text);

      if (rule.type === 'GUARD') {
        // GUARD rules: check if change might reintroduce a fixed bug
        const similarity = weightedJaccard(changeWords, ruleWords, idfWeights);
        // Also check for direct keyword overlap
        const keyOverlap = keywordOverlap(changeWords, ruleWords);
        const matched = getMatchedTerms(changeWords, ruleWords);

        if (similarity > 0.20 || keyOverlap >= 2) {
          violations.push({
            type: 'REGRESSION_RISK',
            rule,
            reason: `Change may reintroduce a previously fixed bug`,
            similarity: Math.round(similarity * 100),
            matchedTerms: matched
          });
        }
      } else if (rule.type === 'DONT') {
        // DONT rules: check if change description contains forbidden keywords
        const keyOverlap = keywordOverlap(changeWords, ruleWords);
        const similarity = weightedJaccard(changeWords, ruleWords, idfWeights);
        const matched = getMatchedTerms(changeWords, ruleWords);

        if (keyOverlap >= 2 || similarity > 0.3) {
          violations.push({
            type: 'RULE_VIOLATION',
            rule,
            reason: `Change violates a DONT rule`,
            similarity: Math.round(similarity * 100),
            matchedTerms: matched
          });
        }
      } else if (rule.type === 'DO') {
        // DO rules: generate warnings if change touches relevant area
        // but doesn't seem to follow the rule
        const similarity = weightedJaccard(changeWords, ruleWords, idfWeights);
        if (similarity > 0.2 && similarity < 0.5) {
          const matched = getMatchedTerms(changeWords, ruleWords);
          warnings.push({
            type: 'CHECK_COMPLIANCE',
            rule,
            reason: `Verify compliance with DO rule`,
            matchedTerms: matched
          });
        }
      }
    }

    // Generate recommendations
    if (violations.length > 0) {
      const guardViolations = violations.filter(v => v.type === 'REGRESSION_RISK');
      for (const v of guardViolations) {
        recommendations.push(`Review fix in ${v.rule.source_id} before proceeding`);
      }
      recommendations.push('If this is an intentional change, record a new decision with brain_record_decision');
    }

    // Check for active decisions that cover these files
    const decisionRules = rules.filter(r => r.source_type === 'decision');
    if (decisionRules.length > 0) {
      const decIds = [...new Set(decisionRules.map(r => r.source_id))];
      warnings.push({
        type: 'ACTIVE_DECISION',
        rule: null,
        reason: `Active decision ${decIds.join(', ')} covers these files`
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
 * Count significant keyword overlaps between two word sets
 */
function keywordOverlap(setA, setB) {
  let count = 0;
  for (const word of setA) {
    if (setB.has(word)) count++;
  }
  return count;
}

/**
 * Get the intersection of two word sets as an array
 */
function getMatchedTerms(setA, setB) {
  return [...setA].filter(w => setB.has(w));
}
