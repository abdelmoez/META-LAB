/**
 * rules/informal.js — 120.md §6 "Potentially informal language".
 *
 * A closed phrase table. §6 insists these are suggestions, never errors: informal is
 * a register judgement, and the user may be quoting a participant or writing a
 * plain-language summary. Every entry offers the formal replacement so the suggestion
 * card has something to apply.
 */

import { CATEGORY, SEVERITY } from '../issueModel.js';
import { emit, isProse } from './ruleUtils.js';

export const RULE_ID = 'wa.informal-language';

/**
 * [regex source, the formal alternative, suggestions]. Sources carry their own
 * inflections so "looked into"/"looking into" are caught alongside "look into" —
 * a phrase list that only matches the infinitive is a list that mostly misses.
 */
const PHRASES = [
  ['a lot of', 'many', ['many', 'much']],
  ['lots of', 'many', ['many']],
  ['a couple of', 'a few', ['a few', 'two']],
  ['tons of', 'many', ['many']],
  ['kind of', 'somewhat', ['somewhat']],
  ['sort of', 'somewhat', ['somewhat']],
  ['a bit', 'slightly', ['slightly']],
  ['things like', 'such as', ['such as']],
  ['stuff', 'material', ['material', 'content']],
  ['nowadays', 'currently', ['currently']],
  ['basically', null, []],
  ['pretty much', 'largely', ['largely']],
  ['figure[ds]? out|figuring out', 'determine', ['determine']],
  ['find[s]? out|found out|finding out', 'determine', ['determine']],
  ['look(?:s|ed|ing)? into', 'investigate', ['investigate']],
  ['get(?:s|ting)? rid of|got rid of', 'eliminate', ['eliminate']],
  ['huge', 'large', ['large', 'substantial']],
  ['okay', 'acceptable', ['acceptable']],
];

/** Contractions — always informal in a manuscript, and always mechanically fixable. */
const CONTRACTIONS = {
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
  "can't": 'cannot', "won't": 'will not', "isn't": 'is not', "aren't": 'are not',
  "wasn't": 'was not', "weren't": 'were not', "hasn't": 'has not',
  "haven't": 'have not', "hadn't": 'had not', "shouldn't": 'should not',
  "couldn't": 'could not', "wouldn't": 'would not', "it's": 'it is',
  "we've": 'we have', "they're": 'they are', "that's": 'that is',
  "there's": 'there is', "we're": 'we are', "we'll": 'we will',
};

const PHRASE_RE = new RegExp(`\\b(?:${PHRASES.map(([p]) => p).join('|')})\\b`, 'gi');
const CONTRACTION_RE = new RegExp(
  `\\b(?:${Object.keys(CONTRACTIONS).map((c) => c.replace("'", "['’]")).join('|')})\\b`,
  'gi',
);

/** Which table row produced this match? (Same lookup shape as rules/style.js.) */
function phraseEntry(matched) {
  const entry = PHRASES.find(([src]) => new RegExp(`^(?:${src})$`, 'i').test(matched));
  return entry ? { formal: entry[1], suggestions: entry[2] } : null;
}

export function informalLanguage(ctx) {
  const issues = [];
  const { text, proseMask } = ctx;

  PHRASE_RE.lastIndex = 0;
  let m;
  while ((m = PHRASE_RE.exec(text)) !== null) {
    const entry = phraseEntry(m[0]);
    if (!entry) continue;
    if (!isProse(proseMask, m.index, m.index + m[0].length)) continue;
    issues.push(emit(ctx, {
      start: m.index,
      end: m.index + m[0].length,
      category: CATEGORY.INFORMAL,
      ruleId: RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.5,
      message: entry.formal
        ? `“${m[0]}” is informal; consider “${entry.formal}”.`
        : `“${m[0]}” adds little in scientific prose.`,
      explanation: 'Scientific writing usually prefers precise, formal wording.',
      suggestions: entry.suggestions,
    }));
  }

  CONTRACTION_RE.lastIndex = 0;
  while ((m = CONTRACTION_RE.exec(text)) !== null) {
    const key = m[0].toLowerCase().replace(/[’]/g, "'");
    const expansion = CONTRACTIONS[key];
    if (!expansion) continue;
    if (!isProse(proseMask, m.index, m.index + m[0].length)) continue;
    issues.push(emit(ctx, {
      start: m.index,
      end: m.index + m[0].length,
      category: CATEGORY.INFORMAL,
      ruleId: RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.65,
      message: `Contractions are informal; write “${expansion}”.`,
      explanation: 'Manuscripts normally spell contractions out in full.',
      suggestions: [expansion],
    }));
  }

  return issues;
}

export default informalLanguage;
