/**
 * rules/agreement.js — 120.md §6 "Subject–verb agreement" and "Singular/plural
 * agreement".
 *
 * Validation case from §6: "The studies was included in the analysis." must be
 * detected. Doing that without a parser is possible only for the SIMPLE shape
 * `determiner + plural head noun + singular verb`, which is exactly what the §6
 * example is. So that is all this rule claims:
 *
 *   - the three tokens must be directly adjacent (no comma, no intervening word, no
 *     prepositional phrase) — "The studies of adults in the cohort was…" is a complex
 *     NP and the rule declines rather than guesses;
 *   - the head noun must look plural under `looksPlural`, which knows that
 *     `analysis`, `consensus`, `series` and `bias` end in `s` and are not;
 *   - confidence is reported, never hidden.
 */

import { TOKEN } from '../tokenize.js';
import { CATEGORY, SEVERITY } from '../issueModel.js';
import {
  PLURAL_DETERMINERS, SINGULAR_DETERMINERS, PLURAL_PRONOUNS, IRREGULAR_PLURALS,
  SINGULAR_TO_PLURAL_VERB, PLURAL_TO_SINGULAR_VERB, FINITE_VERBS,
  looksPlural, looksSingular, adjacent, emit, lexicalTokens, lower,
} from './ruleUtils.js';

export const SUBJECT_VERB_RULE_ID = 'wa.subject-verb-agreement';
export const NUMBER_RULE_ID = 'wa.number-agreement';

/**
 * `determiner + plural noun + singular verb`, plus the plural-pronoun shortcut
 * ("they was", "we has").
 */
export function subjectVerbAgreement(ctx) {
  const issues = [];
  const { text } = ctx;
  const lex = lexicalTokens(ctx.tokens);

  for (let i = 0; i < lex.length - 1; i += 1) {
    const first = lex[i];
    if (first.kind !== TOKEN.WORD) continue;
    const w1 = lower(first);

    // Shortcut: an unambiguous plural pronoun directly before a singular verb.
    const next = lex[i + 1];
    if (PLURAL_PRONOUNS.has(w1) && next && next.kind === TOKEN.WORD
        && adjacent(text, first, next)) {
      const fix = SINGULAR_TO_PLURAL_VERB[lower(next)];
      if (fix && (lower(next) === 'was' || lower(next) === 'is' || lower(next) === 'has'
                  || lower(next) === 'does')) {
        issues.push(emit(ctx, {
          start: next.start,
          end: next.end,
          category: CATEGORY.AGREEMENT,
          ruleId: SUBJECT_VERB_RULE_ID,
          severity: SEVERITY.ERROR,
          confidence: 0.85,
          message: `“${first.text}” is plural, so use “${fix}”.`,
          explanation: 'A plural subject takes a plural verb form.',
          suggestions: [fix],
        }));
        continue;
      }
    }

    if (i > lex.length - 3) continue;
    const noun = lex[i + 1];
    const verb = lex[i + 2];
    if (!noun || !verb) continue;
    if (noun.kind !== TOKEN.WORD || verb.kind !== TOKEN.WORD) continue;
    if (!adjacent(text, first, noun) || !adjacent(text, noun, verb)) continue;

    const nounWord = lower(noun);
    const verbWord = lower(verb);

    // Plural subject + singular verb → "The studies was included".
    if (PLURAL_DETERMINERS.has(w1) && looksPlural(nounWord) && SINGULAR_TO_PLURAL_VERB[verbWord]) {
      const fix = SINGULAR_TO_PLURAL_VERB[verbWord];
      // `the` is the only determiner in the set that is number-neutral, so a
      // finding that rests on `the` alone is reported a notch less confidently.
      const confidence = w1 === 'the' ? 0.75 : 0.85;
      issues.push(emit(ctx, {
        start: verb.start,
        end: verb.end,
        category: CATEGORY.AGREEMENT,
        ruleId: SUBJECT_VERB_RULE_ID,
        severity: SEVERITY.ERROR,
        confidence,
        message: `“${noun.text}” is plural, so use “${fix}”.`,
        explanation: 'A plural subject takes a plural verb form.',
        suggestions: [fix],
      }));
      continue;
    }

    // Singular subject + plural verb → "This study were conducted".
    if (SINGULAR_DETERMINERS.has(w1) && looksSingular(nounWord)
        && !IRREGULAR_PLURALS.has(nounWord) && PLURAL_TO_SINGULAR_VERB[verbWord]) {
      const fix = PLURAL_TO_SINGULAR_VERB[verbWord];
      issues.push(emit(ctx, {
        start: verb.start,
        end: verb.end,
        category: CATEGORY.AGREEMENT,
        ruleId: SUBJECT_VERB_RULE_ID,
        severity: SEVERITY.ERROR,
        confidence: 0.8,
        message: `“${noun.text}” is singular, so use “${fix}”.`,
        explanation: 'A singular subject takes a singular verb form.',
        suggestions: [fix],
      }));
    }
  }
  return issues;
}

/**
 * Determiner/noun number mismatch: "these study", "each patients", "a results".
 * Only fires when the noun is followed by a finite verb, punctuation or the end of
 * the block — that guard removes almost every false positive from noun stacks
 * ("these patient data", "a results section").
 */
export function numberAgreement(ctx) {
  const issues = [];
  const { text } = ctx;
  const lex = lexicalTokens(ctx.tokens);

  for (let i = 0; i < lex.length - 1; i += 1) {
    const det = lex[i];
    const noun = lex[i + 1];
    if (det.kind !== TOKEN.WORD || !noun || noun.kind !== TOKEN.WORD) continue;
    if (!adjacent(text, det, noun)) continue;

    const d = lower(det);
    const n = lower(noun);
    const after = lex[i + 2];
    const boundaryFollows = !after
      || !adjacent(text, noun, after)
      || (after.kind === TOKEN.WORD && FINITE_VERBS.has(lower(after)));
    if (!boundaryFollows) continue;

    if ((d === 'these' || d === 'those') && looksSingular(n) && !IRREGULAR_PLURALS.has(n)) {
      issues.push(emit(ctx, {
        start: det.start,
        end: noun.end,
        category: CATEGORY.AGREEMENT,
        ruleId: NUMBER_RULE_ID,
        severity: SEVERITY.SUGGESTION,
        confidence: 0.6,
        message: `“${det.text}” is plural but “${noun.text}” is singular.`,
        explanation: 'Plural determiners take plural nouns.',
        suggestions: [`${det.text} ${noun.text}s`],
      }));
      continue;
    }
    if ((d === 'this' || d === 'that' || d === 'each' || d === 'every' || d === 'a'
         || d === 'an' || d === 'one') && looksPlural(n)) {
      const singular = n.endsWith('ies') ? `${noun.text.slice(0, -3)}y` : noun.text.slice(0, -1);
      issues.push(emit(ctx, {
        start: det.start,
        end: noun.end,
        category: CATEGORY.AGREEMENT,
        ruleId: NUMBER_RULE_ID,
        severity: SEVERITY.SUGGESTION,
        confidence: 0.6,
        message: `“${det.text}” is singular but “${noun.text}” is plural.`,
        explanation: 'Singular determiners take singular nouns.',
        suggestions: [`${det.text} ${singular}`],
      }));
    }
  }
  return issues;
}
