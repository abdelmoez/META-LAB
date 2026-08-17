/**
 * rules/fragments.js — 120.md §6 "Sentence fragments" and "Run-on sentences".
 *
 * Both rules are deliberately quiet. A fragment detector that fires on anything with
 * an unusual shape ruins a Methods section, and a run-on detector without a parser
 * mostly finds introductory phrases. So:
 *
 *   FRAGMENT — only when the sentence has no verb evidence AT ALL (see
 *   `hasVerbEvidence`, which counts every -ed/-ing/-s word as evidence), or when the
 *   only verb-shaped word is a bare participle with no auxiliary. Headings, captions,
 *   list items and table cells are exempt because they are not meant to be sentences.
 *
 *   RUN-ON — only the comma splice, and only when the words on BOTH sides of the
 *   comma look like independent clauses: verb evidence before it, and a pronoun
 *   subject followed by a finite verb after it. "In this study, we assessed…" has no
 *   verb before the comma and is therefore never flagged.
 */

import { TOKEN } from '../tokenize.js';
import { CATEGORY, SEVERITY } from '../issueModel.js';
import {
  COORDINATORS, FINITE_VERBS, LEADING_ADJUNCTS, SPLICE_SUBJECTS, SUBORDINATORS,
  SENTENCE_EXEMPT_BLOCKS, emit, hasClauseVerb, hasVerbEvidence, lexicalTokens,
  looksPlural, lower,
} from './ruleUtils.js';

export const FRAGMENT_RULE_ID = 'wa.sentence-fragment';
export const RUNON_RULE_ID = 'wa.run-on-sentence';

const tokensIn = (tokens, span) => tokens.filter((t) => t.start >= span.start && t.end <= span.end);

export function sentenceFragment(ctx) {
  if (SENTENCE_EXEMPT_BLOCKS.has(ctx.blockKind)) return [];
  const issues = [];
  for (const sentence of ctx.sentences) {
    const inSpan = tokensIn(ctx.tokens, sentence);
    const words = inSpan.filter((t) => t.kind === TOKEN.WORD);
    if (words.length < 4) continue;
    // A sentence that ends in a colon is introducing something, not asserting.
    if (/:\s*$/.test(sentence.text)) continue;
    if (hasVerbEvidence(inSpan)) {
      // Participle-only shape: "Patients receiving the intervention." — an -ing word
      // with no auxiliary anywhere is the one fragment pattern worth naming.
      const hasFinite = words.some((t) => FINITE_VERBS.has(lower(t)));
      const hasPast = words.some((t) => lower(t).endsWith('ed') && lower(t).length >= 5);
      const hasThirdPerson = words.some((t) => {
        const w = lower(t);
        return w.length >= 4 && w.endsWith('s') && !looksPlural(w);
      });
      const gerund = words.find((t) => lower(t).endsWith('ing') && lower(t).length >= 6);
      if (hasFinite || hasPast || hasThirdPerson || !gerund) continue;
      issues.push(emit(ctx, {
        start: sentence.start,
        end: sentence.end,
        category: CATEGORY.FRAGMENT,
        ruleId: FRAGMENT_RULE_ID,
        severity: SEVERITY.SUGGESTION,
        confidence: 0.4,
        message: 'This may be a sentence fragment.',
        explanation: `“${gerund.text}” is a participle, not a main verb. A complete `
          + 'sentence needs a subject and a finite verb.',
      }));
      continue;
    }
    issues.push(emit(ctx, {
      start: sentence.start,
      end: sentence.end,
      category: CATEGORY.FRAGMENT,
      ruleId: FRAGMENT_RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.45,
      message: 'This may be a sentence fragment.',
      explanation: 'No verb was found in this sentence.',
    }));
  }
  return issues;
}

export function runOnSentence(ctx) {
  if (SENTENCE_EXEMPT_BLOCKS.has(ctx.blockKind)) return [];
  const issues = [];
  for (const sentence of ctx.sentences) {
    const inSpan = tokensIn(ctx.tokens, sentence);
    const lex = lexicalTokens(inSpan);
    // A sentence that opens with an introductory adjunct ("Compared with placebo,",
    // "In these patients,", "Although…,") uses its comma correctly by definition.
    if (lex.length && lex[0].kind === TOKEN.WORD && LEADING_ADJUNCTS.has(lower(lex[0]))) continue;

    for (let c = sentence.start; c < sentence.end; c += 1) {
      if (ctx.text[c] !== ',') continue;
      const before = lex.filter((t) => t.end <= c);
      const after = lex.filter((t) => t.start > c);
      if (before.length < 2 || after.length < 2) continue;
      if (!hasClauseVerb(before)) continue;

      const subject = after[0];
      const verb = after[1];
      if (!subject || subject.kind !== TOKEN.WORD) continue;
      const s = lower(subject);
      if (COORDINATORS.has(s) || SUBORDINATORS.has(s)) continue;
      if (!SPLICE_SUBJECTS.has(s)) continue;
      if (!verb || verb.kind !== TOKEN.WORD) continue;
      const v = lower(verb);
      const verbLike = FINITE_VERBS.has(v)
        || (v.length >= 5 && v.endsWith('ed'))
        || (v.length >= 4 && v.endsWith('s') && !looksPlural(v));
      if (!verbLike) continue;

      // The reported range is the COMMA alone so that applying a suggestion is a
      // single safe replacement (120.md §6 — a correction replaces exactly the
      // reported text). Splitting into two sentences also needs a capital letter,
      // which the user makes deliberately; the explanation says so.
      issues.push(emit(ctx, {
        start: c,
        end: c + 1,
        category: CATEGORY.RUNON,
        ruleId: RUNON_RULE_ID,
        severity: SEVERITY.SUGGESTION,
        confidence: 0.55,
        message: `Two complete sentences may be joined by a comma before “${subject.text}”.`,
        explanation: 'Use a semicolon, split the sentence in two, or add a '
          + 'conjunction such as “and” after the comma.',
        suggestions: [';'],
        meta: { subject: subject.text },
      }));
    }
  }
  return issues;
}
