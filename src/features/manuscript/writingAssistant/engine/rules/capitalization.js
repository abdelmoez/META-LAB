/**
 * rules/capitalization.js — 120.md §6 "Capitalization".
 *
 * Sentence-initial lower case. The exceptions matter more than the rule in a medical
 * manuscript: `pH`, `mRNA`, `p`, `n`, `iPSC` and Greek letters legitimately open a
 * sentence in lower case, and a sentence that begins with a citation chip, a number,
 * an identifier or a masked token has no first word to judge.
 */

import { TOKEN } from '../tokenize.js';
import { CATEGORY, SEVERITY } from '../issueModel.js';
import { emit, LOWERCASE_SENTENCE_STARTS, SENTENCE_EXEMPT_BLOCKS } from './ruleUtils.js';

export const RULE_ID = 'wa.sentence-initial-capital';

export function sentenceCapitalization(ctx) {
  if (SENTENCE_EXEMPT_BLOCKS.has(ctx.blockKind)) return [];
  const issues = [];
  for (const sentence of ctx.sentences) {
    const first = ctx.tokens.find((t) => t.start >= sentence.start && t.end <= sentence.end
      && t.kind !== TOKEN.SPACE && t.kind !== TOKEN.PUNCT && t.kind !== TOKEN.SYMBOL);
    if (!first) continue;
    if (first.kind !== TOKEN.WORD) continue;
    const word = first.text;
    if (word.length < 2) continue;
    if (LOWERCASE_SENTENCE_STARTS.has(word.toLowerCase())) continue;
    if (word[0] !== word[0].toLowerCase()) continue;
    if (!/\p{L}/u.test(word[0])) continue;
    // A word whose SECOND letter is a capital is a deliberate lower-case-initial
    // term (mRNA, iPSC, pH) even when it is not on the exception list.
    if (word.length > 1 && word[1] === word[1].toUpperCase() && /\p{L}/u.test(word[1])) continue;

    issues.push(emit(ctx, {
      start: first.start,
      end: first.end,
      category: CATEGORY.CAPITALIZATION,
      ruleId: RULE_ID,
      severity: SEVERITY.ERROR,
      confidence: 0.8,
      message: `Sentences start with a capital letter: “${word}”.`,
      explanation: 'The first word of a sentence is capitalized.',
      suggestions: [word[0].toUpperCase() + word.slice(1)],
    }));
  }
  return issues;
}

export default sentenceCapitalization;
