/**
 * rules/duplicateWord.js — 120.md §6 "Duplicate words".
 *
 * Validation case from §6: "The the participants were followed for 12 months." must
 * be reported. The trap is the legitimate double: English really does say "had had",
 * "that that" and (in tables) "1 1". So the rule requires the two words to be
 * adjacent with WHITESPACE ONLY between them — a comma, a dash or a sentence boundary
 * makes a repeat intentional — and consults a small allowlist of real doubles.
 */

import { TOKEN } from '../tokenize.js';
import { CATEGORY, SEVERITY } from '../issueModel.js';
import { adjacent, emit } from './ruleUtils.js';

export const RULE_ID = 'wa.duplicate-word';

/** Doubles that are grammatical English. */
const LEGITIMATE_DOUBLES = new Set([
  'had had', 'that that', 'has had', 'have had', 'ha ha', 'no no', 'sic sic',
  'is is', 'did do', 'do do',
]);

/** Words too short or too structural for a repeat to be meaningful evidence. */
const SKIP_WORDS = new Set(['s', 'a', 'i', 'o']);

export function duplicateWord(ctx) {
  const issues = [];
  const { text, tokens } = ctx;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i];
    if (a.kind !== TOKEN.WORD) continue;
    // Find the next lexical token; anything non-whitespace between breaks the pair.
    let j = i + 1;
    while (j < tokens.length && tokens[j].kind === TOKEN.SPACE) j += 1;
    const b = tokens[j];
    if (!b || b.kind !== TOKEN.WORD) continue;
    if (!adjacent(text, a, b)) continue;

    const wa = a.text.toLowerCase();
    const wb = b.text.toLowerCase();
    if (wa !== wb) continue;
    if (SKIP_WORDS.has(wa) || wa.length < 2) continue;
    if (LEGITIMATE_DOUBLES.has(`${wa} ${wb}`)) continue;

    issues.push(emit(ctx, {
      start: a.start,
      end: b.end,
      category: CATEGORY.DUPLICATE,
      ruleId: RULE_ID,
      severity: SEVERITY.ERROR,
      confidence: 0.9,
      message: `Repeated word “${a.text}”.`,
      explanation: 'The same word appears twice in a row. Delete one of them.',
      suggestions: [a.text],
    }));
    i = j;
  }
  return issues;
}

export default duplicateWord;
