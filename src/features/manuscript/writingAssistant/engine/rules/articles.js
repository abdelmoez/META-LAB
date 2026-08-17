/**
 * rules/articles.js — 120.md §6 "Article usage".
 *
 * a/an is chosen by SOUND, not spelling, so this rule carries three exception sets
 * rather than a vowel regex:
 *   - written vowels with a /j/ or /w/ onset take "a"  — a university, a one-time;
 *   - silent `h` takes "an"                            — an hour, an honest broker;
 *   - acronyms follow how they are SPOKEN              — an MRI, an RCT, a NICE
 *     guideline — which is genuinely ambiguous, so acronym findings are reported as
 *     lower-confidence suggestions rather than errors (§6: label confidence).
 */

import { TOKEN } from '../tokenize.js';
import { CATEGORY, SEVERITY } from '../issueModel.js';
import {
  acronymTakesAn, adjacent, emit, lexicalTokens, lower, startsWithVowelSound,
} from './ruleUtils.js';

export const RULE_ID = 'wa.article-a-an';

export function articleUsage(ctx) {
  const issues = [];
  const { text } = ctx;
  const lex = lexicalTokens(ctx.tokens);

  for (let i = 0; i < lex.length - 1; i += 1) {
    const article = lex[i];
    if (article.kind !== TOKEN.WORD) continue;
    const a = lower(article);
    if (a !== 'a' && a !== 'an') continue;

    const next = lex[i + 1];
    if (!next || !adjacent(text, article, next)) continue;

    let needsAn = null;
    let confidence = 0.85;
    let severity = SEVERITY.ERROR;

    if (next.kind === TOKEN.WORD) {
      needsAn = startsWithVowelSound(next.text);
    } else if (next.kind === TOKEN.ACRONYM) {
      needsAn = acronymTakesAn(next.text);
      confidence = 0.6;
      severity = SEVERITY.SUGGESTION;
    } else {
      // Numbers, identifiers and units: how they are read aloud is not knowable
      // from the text, so the rule declines. 120.md §6 — never guess.
      continue;
    }

    const isAn = a === 'an';
    if (needsAn === isAn) continue;

    const fix = needsAn ? 'an' : 'a';
    const cased = article.text[0] === article.text[0].toUpperCase()
      ? fix[0].toUpperCase() + fix.slice(1)
      : fix;
    issues.push(emit(ctx, {
      start: article.start,
      end: article.end,
      category: CATEGORY.ARTICLE,
      ruleId: RULE_ID,
      severity,
      confidence,
      message: `Use “${cased}” before “${next.text}”.`,
      explanation: needsAn
        ? '“an” goes before a word that begins with a vowel sound.'
        : '“a” goes before a word that begins with a consonant sound.',
      suggestions: [cased],
    }));
  }
  return issues;
}

export default articleUsage;
